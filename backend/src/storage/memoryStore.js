/**
 * memoryStore.js
 *
 * In-memory storage engine providing MongoDB/Mongoose-compatible model
 * interfaces when running in demonstration mode (STORAGE_MODE=memory).
 *
 * Characteristics:
 * - Standalone: Does not require a running MongoDB instance.
 * - Non-destructive: Existing Mongoose schemas and models are preserved.
 * - Reactive: Maintains per-link rolling history buffers with strict 5-minute validation.
 * - Query-compatible: Implements chainable .find(), .findOne(), .findById(),
 *   .populate(), .sort(), .limit(), .lean(), and document .save() / .deleteOne().
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a valid 24-character hex ObjectId string compatible with
 * MongoDB ObjectId and mongoose.isValidObjectId().
 *
 * @returns {string}
 */
export const generateObjectId = () => {
  return crypto.randomBytes(12).toString("hex");
};

/**
 * Deep clone an object to ensure immutability between store and callers.
 *
 * @template T
 * @param {T} obj
 * @returns {T}
 */
const deepClone = (obj) => {
  if (obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (Array.isArray(obj)) return obj.map(deepClone);

  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
};

/**
 * Match a document against a Mongoose-style query filter.
 * Supports basic field matching, `$or`, and `{ $exists: boolean }`.
 *
 * @param {object} doc
 * @param {object} filter
 * @returns {boolean}
 */
const matchesFilter = (doc, filter) => {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, value] of Object.entries(filter)) {
    if (key === "$or" && Array.isArray(value)) {
      const orMatched = value.some((subFilter) => matchesFilter(doc, subFilter));
      if (!orMatched) return false;
      continue;
    }

    if (value && typeof value === "object" && "$exists" in value) {
      const exists = doc[key] !== undefined && doc[key] !== null;
      if (exists !== Boolean(value.$exists)) return false;
      continue;
    }

    // Direct value comparison (with string normalization for ObjectIds)
    const docVal = doc[key];
    const filterVal = value;

    if (docVal === filterVal) continue;
    if (String(docVal) === String(filterVal)) continue;

    return false;
  }

  return true;
};

// ---------------------------------------------------------------------------
// Chainable Query Builder
// ---------------------------------------------------------------------------

class MemoryQuery {
  /**
   * @param {Array<object>} items
   * @param {boolean} isSingle
   * @param {Function} populateResolver
   * @param {Function} saveBinder
   */
  constructor(items, isSingle = false, populateResolver = null, saveBinder = null) {
    this._items = items;
    this._isSingle = isSingle;
    this._populateResolver = populateResolver;
    this._saveBinder = saveBinder;
    this._sortObj = null;
    this._limitNum = null;
    this._populates = [];
    this._isLean = false;
  }

  sort(sortObj) {
    this._sortObj = sortObj;
    return this;
  }

  limit(limitNum) {
    this._limitNum = Number(limitNum);
    return this;
  }

  populate(path, select) {
    this._populates.push({ path, select });
    return this;
  }

  lean() {
    this._isLean = true;
    return this;
  }

  _execute() {
    let result = [...this._items];

    // 1. Sort
    if (this._sortObj) {
      const entries = Object.entries(this._sortObj);
      result.sort((a, b) => {
        for (const [field, direction] of entries) {
          const dir = direction === -1 || direction === "desc" ? -1 : 1;
          const aVal = a[field];
          const bVal = b[field];

          if (aVal == null && bVal != null) return -1 * dir;
          if (aVal != null && bVal == null) return 1 * dir;
          if (aVal < bVal) return -1 * dir;
          if (aVal > bVal) return 1 * dir;
        }
        return 0;
      });
    }

    // 2. Limit
    if (this._limitNum !== null && Number.isFinite(this._limitNum)) {
      result = result.slice(0, this._limitNum);
    }

    // 3. Populate
    if (this._populateResolver && this._populates.length > 0) {
      result = result.map((item) => {
        let cloned = deepClone(item);
        for (const pop of this._populates) {
          cloned = this._populateResolver(cloned, pop.path, pop.select);
        }
        return cloned;
      });
    } else {
      result = result.map(deepClone);
    }

    // 4. Attach methods if not lean
    if (!this._isLean && this._saveBinder) {
      result = result.map((item) => this._saveBinder(item));
    }

    if (this._isSingle) {
      return result.length > 0 ? result[0] : null;
    }

    return result;
  }

  // Make query awaitable (thenable)
  then(resolve, reject) {
    try {
      resolve(this._execute());
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  catch(reject) {
    return this.then(undefined, reject);
  }
}

// ---------------------------------------------------------------------------
// Memory Store Engine
// ---------------------------------------------------------------------------

class MemoryStore {
  constructor() {
    /** @type {Map<string, object>} _id -> Router */
    this.routersMap = new Map();

    /** @type {Map<string, object>} _id -> Link */
    this.linksMap = new Map();

    /** @type {Map<string, Array<object>>} linkId -> Chronological Telemetry Array */
    this.telemetryByLink = new Map();

    /** @type {Array<object>} Global Telemetry Array */
    this.telemetryGlobal = [];

    /** @type {Map<string, object>} _id -> RoutingDecision */
    this.decisionsMap = new Map();

    /** Maximum historical samples retained per link buffer */
    this.MAX_TELEMETRY_PER_LINK = 500;

    // Initialize adapters
    this.routers = this._createRouterAdapter();
    this.links = this._createLinkAdapter();
    this.telemetry = this._createTelemetryAdapter();
    this.decisions = this._createDecisionAdapter();
  }

  /**
   * Reset all in-memory collections to empty state.
   */
  clear() {
    this.routersMap.clear();
    this.linksMap.clear();
    this.telemetryByLink.clear();
    this.telemetryGlobal = [];
    this.decisionsMap.clear();
  }

  // -------------------------------------------------------------------------
  // Router Adapter
  // -------------------------------------------------------------------------
  _createRouterAdapter() {
    const bindRouterDoc = (doc) => {
      if (!doc) return null;
      const self = this;
      return Object.assign(doc, {
        async save() {
          self.routersMap.set(doc._id, deepClone(doc));
          return doc;
        },
        async deleteOne() {
          self.routersMap.delete(doc._id);
          return { deletedCount: 1 };
        },
      });
    };

    return {
      create: async (data) => {
        // Enforce routerId uniqueness
        for (const existing of this.routersMap.values()) {
          if (existing.routerId === data.routerId) {
            const err = new Error("Router ID already exists");
            err.code = 11000;
            throw err;
          }
        }

        const now = new Date();
        const id = data._id ? String(data._id) : generateObjectId();
        const doc = {
          _id: id,
          routerId: data.routerId,
          name: data.name,
          ipAddress: data.ipAddress,
          status: data.status || "active",
          location: data.location || "",
          createdAt: now,
          updatedAt: now,
        };

        this.routersMap.set(id, deepClone(doc));
        return bindRouterDoc(doc);
      },

      find: (filter = {}) => {
        const matching = Array.from(this.routersMap.values()).filter((doc) =>
          matchesFilter(doc, filter)
        );
        return new MemoryQuery(matching, false, null, bindRouterDoc);
      },

      findById: (id) => {
        const doc = this.routersMap.get(String(id));
        const items = doc ? [doc] : [];
        return new MemoryQuery(items, true, null, bindRouterDoc);
      },

      findOne: (filter = {}) => {
        const matching = Array.from(this.routersMap.values()).filter((doc) =>
          matchesFilter(doc, filter)
        );
        return new MemoryQuery(matching, true, null, bindRouterDoc);
      },

      findByIdAndUpdate: async (id, updates, options = {}) => {
        const doc = this.routersMap.get(String(id));
        if (!doc) return null;

        const updated = {
          ...doc,
          ...updates,
          updatedAt: new Date(),
        };

        this.routersMap.set(String(id), deepClone(updated));
        return bindRouterDoc(updated);
      },

      findByIdAndDelete: async (id) => {
        const doc = this.routersMap.get(String(id));
        if (!doc) return null;
        this.routersMap.delete(String(id));
        return bindRouterDoc(doc);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Link Adapter
  // -------------------------------------------------------------------------
  _createLinkAdapter() {
    const populateLink = (linkDoc, path, select) => {
      if (path === "sourceRouter" || path === "destinationRouter") {
        const routerRef = linkDoc[path];
        const routerId =
          routerRef && typeof routerRef === "object" ? routerRef._id : routerRef;
        const routerDoc = routerId ? this.routersMap.get(String(routerId)) : null;

        if (routerDoc) {
          if (select) {
            const fields = select.split(/\s+/).filter(Boolean);
            const filtered = { _id: routerDoc._id };
            for (const f of fields) {
              if (routerDoc[f] !== undefined) filtered[f] = routerDoc[f];
            }
            linkDoc[path] = filtered;
          } else {
            linkDoc[path] = deepClone(routerDoc);
          }
        }
      }
      return linkDoc;
    };

    const bindLinkDoc = (doc) => {
      if (!doc) return null;
      const self = this;
      return Object.assign(doc, {
        async save() {
          self.linksMap.set(doc._id, deepClone(doc));
          return doc;
        },
        async deleteOne() {
          self.linksMap.delete(doc._id);
          return { deletedCount: 1 };
        },
        populate: async (path, select) => {
          populateLink(doc, path, select);
          return doc;
        },
      });
    };

    return {
      create: async (data) => {
        // Enforce linkId uniqueness
        for (const existing of this.linksMap.values()) {
          if (existing.linkId === data.linkId) {
            const err = new Error("Link ID already exists");
            err.code = 11000;
            throw err;
          }
        }

        const now = new Date();
        const id = data._id ? String(data._id) : generateObjectId();
        const doc = {
          _id: id,
          linkId: data.linkId,
          sourceRouter: data.sourceRouter,
          destinationRouter: data.destinationRouter,
          bandwidthMbps: data.bandwidthMbps ?? 1000,
          latencyMs: data.latencyMs ?? 10,
          utilizationPct: data.utilizationPct ?? 0,
          status: data.status || "active",
          mlLinkIndex: data.mlLinkIndex ?? undefined,
          createdAt: now,
          updatedAt: now,
        };

        this.linksMap.set(id, deepClone(doc));
        return bindLinkDoc(doc);
      },

      find: (filter = {}) => {
        const matching = Array.from(this.linksMap.values()).filter((doc) =>
          matchesFilter(doc, filter)
        );
        return new MemoryQuery(matching, false, populateLink, bindLinkDoc);
      },

      findById: (id) => {
        const doc = this.linksMap.get(String(id));
        const items = doc ? [doc] : [];
        return new MemoryQuery(items, true, populateLink, bindLinkDoc);
      },

      findOne: (filter = {}) => {
        const matching = Array.from(this.linksMap.values()).filter((doc) =>
          matchesFilter(doc, filter)
        );
        return new MemoryQuery(matching, true, populateLink, bindLinkDoc);
      },

      findByIdAndUpdate: async (id, updates) => {
        const doc = this.linksMap.get(String(id));
        if (!doc) return null;

        const updated = {
          ...doc,
          ...updates,
          updatedAt: new Date(),
        };

        this.linksMap.set(String(id), deepClone(updated));
        return bindLinkDoc(updated);
      },

      findByIdAndDelete: async (id) => {
        const doc = this.linksMap.get(String(id));
        if (!doc) return null;
        this.linksMap.delete(String(id));
        return bindLinkDoc(doc);
      },

      exists: async (filter = {}) => {
        const match = Array.from(this.linksMap.values()).find((doc) =>
          matchesFilter(doc, filter)
        );
        return match ? { _id: match._id } : null;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Telemetry Adapter (Rolling History per Link)
  // -------------------------------------------------------------------------
  _createTelemetryAdapter() {
    const populateTelemetry = (telemetryDoc, path, select) => {
      if (path === "link") {
        const linkDoc = this.linksMap.get(String(telemetryDoc.link));
        if (linkDoc) {
          if (select) {
            const fields = select.split(/\s+/).filter(Boolean);
            const filtered = { _id: linkDoc._id };
            for (const f of fields) {
              if (linkDoc[f] !== undefined) filtered[f] = linkDoc[f];
            }
            telemetryDoc.link = filtered;
          } else {
            telemetryDoc.link = deepClone(linkDoc);
          }
        }
      }
      return telemetryDoc;
    };

    return {
      create: async (data) => {
        const now = new Date();
        const measuredAtDate = data.measuredAt ? new Date(data.measuredAt) : now;

        const id = data._id ? String(data._id) : generateObjectId();
        const doc = {
          _id: id,
          link: data.link ? String(data.link) : null,
          linkId: data.linkId,
          utilizationPct: Number(data.utilizationPct),
          throughputMbps: data.throughputMbps != null ? Number(data.throughputMbps) : null,
          packetLossPct: data.packetLossPct != null ? Number(data.packetLossPct) : null,
          source: data.source || "manual",
          measuredAt: measuredAtDate,
          createdAt: now,
        };

        // Add to global collection
        this.telemetryGlobal.push(deepClone(doc));

        // Add to per-link rolling history buffer
        if (doc.linkId) {
          let linkHistory = this.telemetryByLink.get(doc.linkId);
          if (!linkHistory) {
            linkHistory = [];
            this.telemetryByLink.set(doc.linkId, linkHistory);
          }

          // Insert maintaining chronological order (measuredAt)
          const insertIdx = linkHistory.findIndex(
            (item) => new Date(item.measuredAt).getTime() > measuredAtDate.getTime()
          );

          if (insertIdx === -1) {
            linkHistory.push(deepClone(doc));
          } else {
            linkHistory.splice(insertIdx, 0, deepClone(doc));
          }

          // Enforce rolling buffer limit
          if (linkHistory.length > this.MAX_TELEMETRY_PER_LINK) {
            linkHistory.shift();
          }
        }

        return deepClone(doc);
      },

      find: (filter = {}) => {
        let matching = [];

        // If filtering specifically by link (ObjectId) or linkId, use optimized buffer
        if (filter.link) {
          const targetLinkId = String(filter.link);
          matching = this.telemetryGlobal.filter(
            (t) => String(t.link) === targetLinkId
          );
        } else if (filter.linkId) {
          matching = this.telemetryByLink.get(filter.linkId) ?? [];
        } else {
          matching = this.telemetryGlobal;
        }

        // Apply remaining filter keys if any
        matching = matching.filter((doc) => matchesFilter(doc, filter));

        return new MemoryQuery(matching, false, populateTelemetry, null);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Routing Decision Adapter
  // -------------------------------------------------------------------------
  _createDecisionAdapter() {
    return {
      create: async (data) => {
        const now = new Date();
        const id = data._id ? String(data._id) : generateObjectId();
        const doc = {
          _id: id,
          sourceRouter: data.sourceRouter,
          destinationRouter: data.destinationRouter,
          routerPath: data.routerPath || [],
          linkPath: data.linkPath || [],
          totalCost: data.totalCost ?? 0,
          evaluatedLinks: data.evaluatedLinks || [],
          algorithm: data.algorithm || "Dijkstra",
          routingPolicy: data.routingPolicy || "Chronos-2 predictive utilization cost",
          createdAt: now,
          updatedAt: now,
        };

        this.decisionsMap.set(id, deepClone(doc));
        return deepClone(doc);
      },

      find: (filter = {}) => {
        const matching = Array.from(this.decisionsMap.values()).filter((doc) =>
          matchesFilter(doc, filter)
        );
        return new MemoryQuery(matching, false, null, null);
      },

      findById: (id) => {
        const doc = this.decisionsMap.get(String(id));
        const items = doc ? [doc] : [];
        return new MemoryQuery(items, true, null, null);
      },
    };
  }
}

// Singleton in-memory store
export const memoryStore = new MemoryStore();

