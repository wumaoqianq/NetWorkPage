from django.db import transaction
from workspace.models import Collection, Category, Site
from workspace.http import api, body, ApiError, owned
from workspace.validation import text
from workspace.library import defaults, collection_dto


@api(['GET', 'POST', 'PATCH', 'DELETE'])
def collections(request, pk=None):
    defaults(request.user)
    if request.method == 'GET':
        return {'collections': [collection_dto(c) for c in Collection.objects.filter(owner=request.user)]}
    data = body(request)
    with transaction.atomic():
        if request.method == 'POST':
            collection = Collection.objects.create(owner=request.user, name=text(data.get('name', ''), 100, True),
                description=text(data.get('description', ''), 500))
        else:
            collection = owned(Collection, request.user, pk or data.get('id'))
            if request.method == 'DELETE':
                for site in Site.objects.filter(owner=request.user):
                    if str(collection.pk) in site.payload['collections']:
                        site.payload['collections'].remove(str(collection.pk))
                        site.version += 1
                        site.save(update_fields=['payload', 'version', 'updated_at'])
                collection.delete()
                return {'deleted': True}
            collection.name = text(data.get('name', collection.name), 100, True)
            collection.description = text(data.get('description', collection.description), 500)
            collection.save()
        return collection_dto(collection)


@api(['GET', 'POST', 'PATCH', 'DELETE'])
def categories(request, pk=None):
    defaults(request.user)
    if request.method == 'GET':
        return {'categories': list(Category.objects.filter(owner=request.user).values_list('name', flat=True))}
    data = body(request)
    name = text(data.get('name', pk or ''), 100, True)
    created, affected = False, 0
    with transaction.atomic():
        if request.method == 'POST':
            _, created = Category.objects.get_or_create(owner=request.user, name=name)
        else:
            category = Category.objects.filter(owner=request.user, name=pk or data.get('oldName', name)).first()
            if not category:
                raise ApiError('分类不存在', 'not_found', 404)
            old = category.name
            new = '' if request.method == 'DELETE' else name
            for site in Site.objects.filter(owner=request.user):
                if site.payload.get('category') == old:
                    site.payload['category'] = new
                    site.version += 1
                    site.save(update_fields=['payload', 'version', 'updated_at'])
                    affected += 1
            if request.method == 'DELETE':
                category.delete()
            else:
                category.name = new
                category.save()
        return {'categories': list(Category.objects.filter(owner=request.user).values_list('name', flat=True)),
                'created': created, 'affected': affected, 'deleted': request.method == 'DELETE'}
