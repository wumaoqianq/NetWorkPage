from django.apps import AppConfig


class WorkspaceConfig(AppConfig):
    name = 'workspace'

    def ready(self):
        from django.db.backends.signals import connection_created
        from workspace.sqlite import configure_sqlite
        connection_created.connect(configure_sqlite, dispatch_uid='workspace.sqlite')
