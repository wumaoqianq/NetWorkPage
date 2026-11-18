"""单机低内存配置；部署参数全部由环境提供。"""
import os
from pathlib import Path
import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parents[2]
env = environ.Env()
environ.Env.read_env(BASE_DIR / '.env.local', overwrite=False)
DEBUG = env.bool('DEBUG', default=False)
SECRET_KEY = env('SECRET_KEY', default='development-only-change-before-deploy' if DEBUG else '')
if not SECRET_KEY:
    raise ImproperlyConfigured('生产环境必须显式设置 SECRET_KEY')
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1', 'testserver'])
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'workspace.apps.WorkspaceConfig', 'enhancements']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
              'django.contrib.auth.middleware.AuthenticationMiddleware',
              'django.middleware.clickjacking.XFrameOptionsMiddleware', 'workspace.middleware.ApiMiddleware']
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
DATA_DIR = Path(env('DATA_DIR', default=str(BASE_DIR / 'data')))
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3',
                        'NAME': env('DATABASE_PATH', default=str(DATA_DIR / 'workspace.sqlite3')),
                        'OPTIONS': {'timeout': 20, 'transaction_mode': 'IMMEDIATE'}}}
Path(DATABASES['default']['NAME']).parent.mkdir(parents=True, exist_ok=True)
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
    {'NAME': 'workspace.passwords.StrengthValidator'},
]
LANGUAGE_CODE = 'zh-hans'
STATIC_URL = '/static/'
TIME_ZONE = 'Asia/Shanghai'
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
APPEND_SLASH = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = env.bool('COOKIE_SECURE', default=not DEBUG)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])
CSRF_FAILURE_VIEW = 'workspace.http.csrf_failure'
SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=False)
# 验证真实 HTTPS 后由维护者逐步开启；不要默认把尚未配置证书的域名锁定。
SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=0)
if env.bool('TRUST_PROXY', default=False):
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
MAX_SITES = env.int('MAX_SITES', default=10000)
MEDIA_ROOT = DATA_DIR / 'media'
PREVIEW_QUOTA_BYTES = env.int('PREVIEW_QUOTA_BYTES', default=100 * 1024 * 1024)
ICON_QUOTA_BYTES = env.int('ICON_QUOTA_BYTES', default=4 * 1024 * 1024)
SETUP_TOKEN = env('SETUP_TOKEN', default='')
SETUP_ENABLED = env.bool('SETUP_ENABLED', default=True)
ALLOW_LOCAL_SETUP = env.bool('ALLOW_LOCAL_SETUP', default=False)
RATE_LIMIT_ENABLED = env.bool('RATE_LIMIT_ENABLED', default=True)
FRONTEND_ROOT = BASE_DIR / 'prototype' / 'dist' / 'client'
PUBLIC_URL = env('PUBLIC_URL', default='')
LOGGING = {'version': 1, 'disable_existing_loggers': False,
           'handlers': {'null': {'class': 'logging.NullHandler'}},
           'loggers': {name: {'handlers': ['null'], 'propagate': False} for name in ['django.server', 'django.request', 'django.security.csrf']}}
