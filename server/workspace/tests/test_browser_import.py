import json
from workspace.tests.base import ApiTest
from workspace.models import Site


class BrowserImportTests(ApiTest):
    def test_chromium_tree_preserves_folders_and_skips_unsupported_urls(self):
        content = {'roots': {'bookmark_bar': {'type': 'folder', 'name': '收藏栏', 'children': [
            {'type': 'folder', 'name': '工具', 'children': [
                {'type': 'url', 'name': '压图', 'url': 'https://compress.example.test'},
                {'type': 'url', 'name': '重复', 'url': 'https://compress.example.test/'},
                {'type': 'url', 'name': '设置', 'url': 'chrome://settings'},
                {'type': 'url', 'name': '脚本', 'url': 'javascript:alert(1)'},
            ]}]}}}
        response = self.send('/api/imports/preview', {'format': 'chromium', 'source': 'ego-lite',
                                                     'content': json.dumps(content)})
        self.assertEqual(response.status_code, 200)
        preview = response.json()
        self.assertEqual((preview['count'], preview['duplicates'], preview['skippedUnsupported']), (1, 1, 2))
        self.assertEqual(preview['source'], 'ego-lite')
        self.assertIn('收藏栏 / 工具', preview['preview'][0]['notes'])
        self.assertTrue(preview['warnings'])
        self.assertEqual(self.send('/api/imports/'+preview['id']+'/commit').json()['imported'], 1)
        self.client.force_login(self.b)
        self.assertEqual(self.client.get('/api/workspace').json()['sites'], [])
        self.assertEqual(self.send('/api/imports/'+preview['id']+'/commit').status_code, 404)

    def test_html_browser_import_skips_internal_links_but_retains_safe_ones(self):
        content = '<DL><DT><H3>开发</H3><DL><DT><A HREF="https://valid.test">正常</A><DT><A HREF="edge://favorites">内部</A></DL></DL>'
        preview = self.send('/api/imports/preview', {'format': 'html', 'source': 'edge', 'content': content}).json()
        self.assertEqual(preview['count'], 1)
        self.assertEqual(preview['skippedUnsupported'], 1)
        self.assertIn('开发', preview['preview'][0]['notes'])

    def test_invalid_trees_and_too_many_bookmarks_are_rejected_without_writes(self):
        for content in [{'roots': []}, {'roots': {'a': {'type': 'folder', 'children': 'bad'}}},
                        {'roots': {'a': {'type': 'folder', 'children': [
                            {'type': 'url', 'url': f'https://item.test/{i}'} for i in range(501)]}}}]:
            response = self.send('/api/imports/preview', {'format': 'chromium', 'content': content})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(Site.objects.count(), 0)
