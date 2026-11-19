from django.urls import include, path

urlpatterns = [path('api/enhancements/', include('enhancements.urls'))]
