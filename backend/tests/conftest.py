import os

# app.main reads this at import time
os.environ.setdefault('SHARED_JWT_SECRET', 'test-shared-secret')
