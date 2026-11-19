/** 分页读取仅在全部成功后交给界面；中途切换账号不能合并两个资料库。 */
export async function loadWorkspace(client) {
  const data = await client.request('/api/workspace');
  const sites = new Map(data.sites.map(site => [site.id, site]));
  let next = data.nextSitePage;
  let previous = 1;
  while (next != null) {
    if (!Number.isInteger(next) || next <= previous || next > 100) {
      throw new Error('收藏分页异常，请刷新后重试');
    }
    const page = await client.request(`/api/sites?page=${next}&limit=250`);
    if (page.userId !== data.user.id || !Array.isArray(page.sites) || page.sites.length === 0) {
      throw new Error('登录状态或收藏分页已变化，请重新登录后重试');
    }
    for (const site of page.sites) sites.set(site.id, site);
    previous = next;
    next = page.nextPage;
  }
  return { ...data, sites: [...sites.values()] };
}
