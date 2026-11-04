from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.pipeline import Pipeline
from .features import NUMERIC_FEATURES, CATEGORICAL_FEATURES

def get_preprocessor(model_type='linear'):
    """
    Returns a scikit-learn ColumnTransformer for preprocessing.
    model_type: 'linear' or 'tree'
    For linear models, we scale numeric features and one-hot encode categorical features.
    For tree models, we pass through categorical (as they are already integers 1-30) or OHE them if preferred, 
    but for simplicity and performance we'll just OHE them for all, or standard scale.
    Actually, HistGradientBoosting can handle categorical natively, but we can just use standard preprocessing.
    """
    
    if model_type == 'linear':
        preprocessor = ColumnTransformer(
            transformers=[
                ('num', StandardScaler(), NUMERIC_FEATURES),
                ('cat', OneHotEncoder(handle_unknown='ignore', drop='first'), CATEGORICAL_FEATURES)
            ]
        )
    else:
        # Tree-based models: scaling doesn't hurt, OHE is fine. 
        # For simplicity we'll just OHE link_index for trees too so features are consistent, 
        # or just pass it as numerical. Let's OHE it so we don't assume arbitrary order of link_index.
        preprocessor = ColumnTransformer(
            transformers=[
                ('num', StandardScaler(), NUMERIC_FEATURES),
                ('cat', OneHotEncoder(handle_unknown='ignore'), CATEGORICAL_FEATURES)
            ]
        )
        
    return preprocessor
