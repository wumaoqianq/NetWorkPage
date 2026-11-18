"""服务器管理员在核验身份后，通过隐藏输入重设密码或发放短时恢复令牌。"""
from getpass import getpass
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from workspace.identity import change_password, issue_recovery, revoke_sessions


class Command(BaseCommand):
    help = '核验身份后恢复平台账号；不接受明文密码参数，不创建预置账号'

    def add_arguments(self, parser):
        parser.add_argument('--email', required=True)
        parser.add_argument('--issue-token', action='store_true', help='发放 15 分钟一次性令牌，请通过可信渠道交付')

    def handle(self, *args, **options):
        user = User.objects.filter(email=options['email'].strip().lower()).first()
        if not user:
            raise CommandError('账号不存在')
        with transaction.atomic():
            if options['issue_token']:
                result = issue_recovery(user)
                self.stdout.write('一次性恢复令牌（仅显示一次）：' + result['token'])
                self.stdout.write('到期时间：' + result['expiresAt'])
                return
            password = getpass('新密码：')
            if password != getpass('再次输入新密码：'):
                raise CommandError('两次密码不一致')
            try:
                change_password(user, password)
            except ValidationError as exc:
                raise CommandError('；'.join(exc.messages)) from exc
            revoke_sessions(user)
        self.stdout.write(self.style.SUCCESS('密码已更新，旧会话、设备凭证与恢复令牌已撤销'))
