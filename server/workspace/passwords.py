from django.core.exceptions import ValidationError


class StrengthValidator:
    """长度和常见密码由内置校验处理，此处补充字符组合限制。"""
    def validate(self, password, user=None):
        categories = [any(c.islower() for c in password), any(c.isupper() for c in password),
                      any(c.isdigit() for c in password), any(not c.isalnum() for c in password)]
        if sum(categories) < 3:
            raise ValidationError(self.get_help_text(), code='password_too_simple')

    def get_help_text(self):
        return '密码至少 12 位，并包含大写字母、小写字母、数字、符号中的三类'
