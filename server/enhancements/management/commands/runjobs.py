import json
from django.core.management.base import BaseCommand
from enhancements.jobs import run_jobs


class Command(BaseCommand):
    help = '串行处理到期站内提醒、显式启用的公网监控与公开图标补齐；单次有界，默认最多10项'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=10)

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(run_jobs(options['limit']), ensure_ascii=False))
