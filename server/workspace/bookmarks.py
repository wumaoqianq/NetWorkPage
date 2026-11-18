"""使用标准 HTMLParser 读取 Netscape 书签，不执行脚本或读取远程资源。"""
from html.parser import HTMLParser
from workspace.http import ApiError


class BookmarkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sites = []
        self.current = None
        self.heading = None
        self.folders = []
        self.pending_folder = None
        self.folder_stack = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'h3':
            self.heading = ''
        if tag == 'dl':
            pushed = self.pending_folder is not None
            if pushed:
                self.folders.append(self.pending_folder)
                self.pending_folder = None
            self.folder_stack.append(pushed)
        if tag == 'a' and 'href' in attributes:
            if len(self.sites) >= 500:
                raise ApiError('一次最多导入 500 条网站')
            folder = ' / '.join(self.folders)
            self.current = {'name': '', 'notes': '导入文件夹：' + folder if folder else '',
                            'endpoints': [{'url': attributes['href']}], 'inbox': True}

    def handle_data(self, data):
        if self.current is not None:
            self.current['name'] += data
        if self.heading is not None:
            self.heading += data

    def handle_endtag(self, tag):
        if tag == 'a' and self.current is not None:
            self.current['name'] = self.current['name'].strip() or self.current['endpoints'][0]['url']
            self.sites.append(self.current)
            self.current = None
        if tag == 'h3' and self.heading is not None:
            self.pending_folder = self.heading.strip()[:500]
            self.heading = None
        if tag == 'dl' and self.folder_stack:
            if self.folder_stack.pop() and self.folders:
                self.folders.pop()


def parse_bookmarks(content):
    parser = BookmarkParser()
    parser.feed(content)
    parser.close()
    return parser.sites
