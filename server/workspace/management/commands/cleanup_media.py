from django.core.management.base import BaseCommand
from workspace.media import collect_garbage


class Command(BaseCommand):
    help = 'Mark unreferenced preview files and delete only those orphaned for at least seven days'

    def handle(self, *args, **options):
        deleted = collect_garbage()
        self.stdout.write(f'Media cleanup completed; {len(deleted)} expired orphan files deleted')
