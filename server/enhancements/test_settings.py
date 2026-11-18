import os

os.environ.setdefault('DEBUG', 'true')
from config.settings import *  # noqa: F403

INSTALLED_APPS = list(INSTALLED_APPS)  # noqa: F405
if 'enhancements' not in INSTALLED_APPS:
    INSTALLED_APPS.append('enhancements')
ROOT_URLCONF = 'enhancements.test_urls'
RATE_LIMIT_ENABLED = False
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
