from django.urls import path
from enhancements import shares, metadata, reminders

urlpatterns = [
    path('shares', shares.shares),
    path('shares/<str:pk>', shares.revoke),
    path('public/shares/<str:token>', shares.public_share),
    path('sites/<str:pk>/metadata', metadata.metadata),
    path('sites/<str:pk>/archives', metadata.archives),
    path('sites/<str:pk>/monitor', metadata.monitor),
    path('reminders', reminders.reminders),
    path('reminders/<str:pk>', reminders.delete_reminder),
    path('notifications', reminders.notifications),
    path('notifications/<str:pk>', reminders.read_notification),
]
