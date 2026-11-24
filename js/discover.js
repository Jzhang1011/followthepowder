// Resort discovery (default home) + basic resort view for catalog resorts without a full dashboard.
// Data: data/catalog.json (static, verified) + api/catalog-conditions.json (Open-Meteo model, refreshed hourly by
// the ski-data Worker; resort-published base depth / terrain open / lifts / 24 h snow where SkiDay reads a public feed) + api/forecast.json?r=<id> (basic view).
import { fmt, weatherEmoji, chainLevel, recommendFrom, visLevel } from './core.js?v=e5736c6b05';
import { getRoute, getTable } from './start.js?v=e5736c6b05';

const S = {
  en: {
    d_title: 'Find your next great ski day.', d_sub: 'Compare ski resorts, discover where conditions are best, and plan your next mountain trip.',
    d_plan: 'Plan a Ski Trip',
    d_search: 'Search resort, town, state, range or pass…', d_near: 'Near Me', d_fav: 'Favorites', d_best: 'Best Conditions', d_explore: 'Explore Resorts',
    d_recent: 'Recently viewed', d_from: 'Distances from', d_useloc: 'Use my location', d_approx: 'Approximate location (from your network)', d_locating: 'Finding you…', d_loc_fail: 'Location unavailable; using your starting point.',
    d_filters: 'Filters', d_region: 'Region', d_pass: 'Pass', d_status: 'Status', d_dist: 'Distance', d_sort: 'Sort', d_all: 'All', d_allr: 'All regions', d_allp: 'All passes', d_other: 'Other', d_any: 'Any',
    d_open_only: 'Open (reported)', d_hide_closed: 'Hide reported closed', d_within: 'Within {0}', d_list: 'List', d_map: 'Map',
    s_score: 'Best overall', s_snow: 'Most new snow (24 h)', s_close: 'Closest', s_fcst: 'Most snowfall (next 72 h)', s_base: 'Deepest base', s_terrain: 'Most terrain open', s_open: 'Open first',
    d_view: 'View conditions', d_addfav: 'Add to favorites', d_remfav: 'Remove from favorites', d_compare: 'Compare', d_compare_n: 'Compare {0}', d_clear: 'Clear',
    d_temp: 'summit now', d_new: 'new 24 h', d_fc72: 'next 72 h', d_drive: 'drive', d_nt: 'no traffic', d_straight: 'straight-line', d_wind: 'summit wind',
    d_open: 'Open', d_closed: 'Closed', d_lifts: '{0}/{1} lifts', d_nolift: 'Lifts not reported', d_upd: 'Updated {0}', d_model: 'Snowfall forecast, temperature and wind: Open-Meteo model estimate. Base depth, terrain open, lifts and ✓ new snow: the resort’s own published report; “Not reported” when it doesn’t publish one SkiDay can read.',
    d_base: 'base depth', d_terrain: 'terrain open', d_nr: 'Not reported', d_acres: '{0}/{1} acres open', d_trails: '{0}/{1} trails open', d_rep_src: 'Resort report: {0}', d_dist_start: 'Distance from start', d_rep: 'resort-reported',
    d_fav_empty: 'No favorites yet. Tap ☆ on any resort to save it here.', d_none: 'No resorts match these filters.', d_results: 'Results for “{0}”', d_nearby: 'Near {0}',
    d_cond_na: 'Conditions are temporarily unavailable. Resort details still work.', d_nresorts: '{0} resorts', d_full: 'Full dashboard', d_basic: 'Basic',
    d_score: 'Ski-day score', d_score_help: 'Score out of 100. Snow up to 35 pts (new 24 h snow ×4 + next-72 h forecast ×1.5, in inches; the resort’s reported 24 h snow when it has one, otherwise the model). Base depth up to 15 and terrain open up to 20, both resort-reported and scored against the deepest base and the most terrain open that any resort reports today (so early-season 9% open can earn full points). Weather up to 15: summit wind up to 10 (full under 10 mph, zero at 40 mph+) and summit temperature up to 5 (best 15–30°F); temperature is no longer on the card but still counts a little. Distance from your starting point up to 15 (straight-line: full within 100 km / 60 mi, zero beyond 800 km / 500 mi). If a resort doesn’t report base depth or terrain, that part gets half points, so missing data neither lifts nor sinks it. A resort that reports itself closed is scored ×0.3.',
    d_best_near: 'Best ski options today', d_near_h: 'Closest to you', d_drive_note: 'Sorted by straight-line distance from {0}. Open a resort for the drive time from there.',
    d_best_note: 'Ranked by ski-day score (snow, base depth, terrain open, weather and distance from {0}). Tap ⓘ Ski-day score for how it works.',
    d_explore_h: 'Explore by region', d_back: 'All resorts', d_cmp_h: 'Compare resorts', d_close: 'Close', d_score_s: 'score',
    b_limited: 'Basic view: weather-model forecast only. SkiDay can’t read a published lift, terrain or snow report for this resort, and has no road data here. Always check the official snow report before you go.',
    b_limited_rep: 'Basic view: base depth, terrain open, lifts and ✓ new snow come from the resort’s own report ({0}); forecasts are Open-Meteo model estimates. No road data here. Always check the official snow report before you go.',
    b_now: 'Now', b_mid: 'mid-mountain', b_summit: 'summit', b_48: 'Next 48 hours', b_7d: '7-day forecast', b_day: 'Day', b_snow: 'Snow', b_hilo: 'High / low', b_wind: 'Wind',
    b_get: 'Getting there', b_links: 'Official links', b_site: 'Resort website', b_report: 'Snow report, lifts & webcams (official site)', b_dir: 'Directions (Google Maps)',
    b_loading: 'Loading forecast…', b_fc_fail: 'Forecast unavailable right now.', b_route_loading: 'Estimating drive…', b_route_fail: 'Drive estimate unavailable.',
    b_elev: 'Elevation', b_pass: 'Pass', b_range: 'Range', b_src: 'Coordinates/elevation source', b_fc_src: 'Forecast: Open-Meteo, {0} grid point at {1}.', b_drive_from: 'from {0}',
    b_snow_bars: 'Snow (bars)', b_temp_line: 'Temperature (line)',
    c_open: 'Open', c_limited: 'Limited', c_closed: 'Closed', c_nr: 'Status not reported', c_lifts: '{0} of {1} lifts running', c_lifts_s: 'lifts', c_new_rep: 'new 24 h · resort', c_new_mod: 'new 24 h · model',
    c_season_open: 'Season open', c_season_rep: 'Resort report updated {0}', c_season_old: 'No resort update since {0}', c_season_nr: 'Season status not reported',
    c_score_of: '/100', c_score_why: 'Why this score?', c_lt1: '<1%',
    x_snow: 'Snow (new 24 h + next 72 h)', x_base: 'Base depth', x_terrain: 'Terrain open', x_weather: 'Summit wind + temperature', x_dist: 'Distance from your start',
    x_half: 'not reported, neutral half points', x_closed: 'Resort reports itself closed: score ×0.3', x_season: 'Base and terrain are compared with the deepest base and most terrain any resort reports today, so early-season numbers aren’t judged by mid-winter standards. Crowds are not included: SkiDay has no reliable crowd data.',
    x_pos: 'Helping', x_neg: 'Holding it back', x_mid: 'Neutral',
    p_title: 'Plan a Ski Trip', p_soon: 'Coming soon', p_lead: 'Trip planning is the next part of SkiDay: choose dates, where you start and which passes you hold, and compare destinations for a multi-day trip.',
    p_now: 'You can already:', p_now1: 'See where conditions are best today', p_now2: 'Explore resorts by region and pass', p_now3: 'Compare up to four resorts side by side (tick “Compare” on any card)', p_now4: 'Open a resort for drive estimates from your starting point',
    p_note: 'Nothing here is booked or saved for you. When planning launches it will use the same live data as the rest of SkiDay.', p_back: '← Back to Best Conditions'
  },
  zh: {
    d_title: '找到你的下一个好雪天。', d_sub: '对比雪场，看看哪里雪况最好，规划你的下一次进山之旅。',
    d_plan: '规划滑雪旅行',
    d_search: '搜索雪场、城镇、州、山脉或雪票…', d_near: '附近', d_fav: '收藏', d_best: '最佳雪况', d_explore: '探索雪场',
    d_recent: '最近浏览', d_from: '距离起点', d_useloc: '使用我的位置', d_approx: '大致位置（根据你的网络）', d_locating: '定位中…', d_loc_fail: '无法定位，改用你的出发地。',
    d_filters: '筛选', d_region: '地区', d_pass: '雪票', d_status: '状态', d_dist: '距离', d_sort: '排序', d_all: '全部', d_allr: '全部地区', d_allp: '全部雪票', d_other: '其他', d_any: '不限',
    d_open_only: '营业中（雪场公布）', d_hide_closed: '隐藏已公布关闭', d_within: '{0} 以内', d_list: '列表', d_map: '地图',
    s_score: '综合最佳', s_snow: '24小时新雪最多', s_close: '最近', s_fcst: '未来72小时降雪最多', s_base: '雪底最深', s_terrain: '开放雪道最多', s_open: '营业优先',
    d_view: '查看雪况', d_addfav: '加入收藏', d_remfav: '取消收藏', d_compare: '对比', d_compare_n: '对比 {0} 个', d_clear: '清除',
    d_temp: '山顶现在', d_new: '24小时新雪', d_fc72: '未来72小时', d_drive: '车程', d_nt: '未计路况', d_straight: '直线距离', d_wind: '山顶风速',
    d_open: '营业中', d_closed: '已关闭', d_lifts: '缆车 {0}/{1}', d_nolift: '缆车未公布', d_upd: '更新于 {0}', d_model: '降雪预报、气温和风：Open-Meteo 模型估算。雪底深度、雪道开放、缆车和带 ✓ 的新雪：来自雪场自己公布的报告；雪场没有可读取的报告时显示“未公布”。',
    d_base: '雪底深度', d_terrain: '雪道开放', d_nr: '未公布', d_acres: '已开放 {0}/{1} 英亩', d_trails: '已开放 {0}/{1} 条雪道', d_rep_src: '雪场报告：{0}', d_dist_start: '距出发地', d_rep: '雪场公布',
    d_fav_empty: '还没有收藏。点任意雪场上的 ☆ 即可收藏。', d_none: '没有符合筛选条件的雪场。', d_results: '“{0}” 的搜索结果', d_nearby: '{0} 附近',
    d_cond_na: '雪况暂时无法获取，雪场详情仍可查看。', d_nresorts: '{0} 个雪场', d_full: '完整看板', d_basic: '基础',
    d_score: '滑雪日评分', d_score_help: '满分 100。降雪最高 35 分（24 小时新雪英寸 ×4 + 未来 72 小时预报降雪英寸 ×1.5；有雪场公布的 24 小时新雪就用公布值，否则用模型）。雪底深度最高 15 分、雪道开放最高 20 分，均为雪场公布数据，并与今天所有雪场公布的最深雪底和最高开放比例相比（所以早季开放 9% 也可能拿满分）。天气最高 15 分：山顶风速最高 10 分（10 mph 以下满分，40 mph 以上 0 分），山顶气温最高 5 分（15–30°F 最佳）；气温不再显示在卡片上，但仍占少量分数。距出发地最高 15 分（直线距离：100 公里 / 60 英里内满分，超过 800 公里 / 500 英里为 0）。雪场没有公布雪底或雪道数据时，该项给一半分，既不加分也不拖累。雪场公布关闭则 ×0.3。',
    d_best_near: '今天的最佳滑雪选择', d_near_h: '离你最近', d_drive_note: '按距 {0} 的直线距离排序。打开雪场可查看从出发地的车程。',
    d_best_note: '按滑雪日评分排序（降雪、雪底深度、雪道开放、天气和距 {0} 的远近）。点 ⓘ 滑雪日评分 查看算法。',
    d_explore_h: '按地区浏览', d_back: '全部雪场', d_cmp_h: '雪场对比', d_close: '关闭', d_score_s: '分',
    b_limited: '基础视图：仅有天气模型预报。SkiDay 读取不到此雪场公布的缆车、雪道或雪况报告，也没有这里的路况数据。出发前请务必查看雪场官方雪况报告。',
    b_limited_rep: '基础视图：雪底深度、雪道开放、缆车和带 ✓ 的新雪来自雪场自己的报告（{0}）；预报为 Open-Meteo 模型估算。这里没有路况数据。出发前请务必查看雪场官方雪况报告。',
    b_now: '现在', b_mid: '半山', b_summit: '山顶', b_48: '未来 48 小时', b_7d: '7 天预报', b_day: '日期', b_snow: '降雪', b_hilo: '最高 / 最低', b_wind: '风',
    b_get: '怎么去', b_links: '官方链接', b_site: '雪场官网', b_report: '雪况、缆车和摄像头（官网）', b_dir: '导航（Google 地图）',
    b_loading: '正在加载预报…', b_fc_fail: '暂时无法获取预报。', b_route_loading: '正在估算车程…', b_route_fail: '无法估算车程。',
    b_elev: '海拔', b_pass: '雪票', b_range: '山脉', b_src: '坐标/海拔来源', b_fc_src: '预报：Open-Meteo，{0}格点，海拔 {1}。', b_drive_from: '从 {0} 出发',
    b_snow_bars: '降雪（柱）', b_temp_line: '气温（线）',
    c_open: '营业中', c_limited: '部分开放', c_closed: '未开放', c_nr: '状态未公布', c_lifts: '缆车运行 {0}/{1}', c_lifts_s: '缆车', c_new_rep: '24小时新雪 · 雪场', c_new_mod: '24小时新雪 · 模型',
    c_season_open: '雪季已开放', c_season_rep: '雪场报告更新于 {0}', c_season_old: '自 {0} 起雪场未更新报告', c_season_nr: '雪季状态未公布',
    c_score_of: '/100', c_score_why: '为什么是这个分数？', c_lt1: '<1%',
    x_snow: '降雪（24小时新雪 + 未来72小时）', x_base: '雪底深度', x_terrain: '雪道开放', x_weather: '山顶风速 + 气温', x_dist: '距出发地',
    x_half: '未公布，按中性一半分计', x_closed: '雪场公布关闭：分数 ×0.3', x_season: '雪底和雪道开放与今天所有雪场公布的最好数值相比，所以初雪季的数字不会按隆冬标准评判。不含人流：SkiDay 没有可靠的人流数据。',
    x_pos: '加分', x_neg: '减分', x_mid: '中性',
    p_title: '规划滑雪旅行', p_soon: '即将推出', p_lead: '行程规划是 SkiDay 的下一步：选择日期、出发地和你持有的雪票，对比多日旅行的目的地。',
    p_now: '现在已经可以：', p_now1: '查看今天哪里雪况最好', p_now2: '按地区和雪票浏览雪场', p_now3: '最多对比四个雪场（在卡片上勾选“对比”）', p_now4: '打开雪场查看从出发地的车程估算',
    p_note: '这里不会为你预订或保存任何内容。上线后将使用与 SkiDay 其他部分相同的实时数据。', p_back: '← 返回最佳雪况'
  }
};
// Alternatives ("Not looking great here?") — stage 2.
Object.assign(S.en, {
  a_h: 'Not looking great here? Compare nearby mountains.',
  a_lead: 'Open resorts near {0} that look better or comparable today, ranked by ski-day score, drive from {1}, pass match and road reports.',
  a_none: 'Nothing nearby looks better than {0} right now.',
  a_none_why: 'Checked {0} resorts within reach: {1}.',
  a_x_closed: '{0} closed', a_x_nr: '{0} without a report SkiDay can read', a_x_worse: '{0} looking worse today', a_x_road: '{0} with a CDOT closure or chain law nearby', a_x_wind: '{0} with strong summit gusts',
  a_drive_est: '≈ {0}', a_drive_osrm: 'drive · road estimate, no traffic', a_drive_line: 'drive · rough straight-line estimate',
  a_pass_same: 'Same pass ({0})', a_pass_diff: 'Different pass ({0})', a_pass_ticket: 'Lift ticket',
  a_terrain: 'terrain open', a_snow: 'new 24 h', a_view: 'View conditions',
  a_r_open: 'Open with {0} lifts running while {1} is closed.', a_r_notlim: 'More of the mountain running: {0} lifts vs {1} here.',
  a_r_terrain: '{0} of terrain open vs {1} here.', a_r_snow: '{0} of new snow in 24 h vs {1} here.', a_r_lifts: '{0} lifts running vs {1} here.',
  a_r_closer: 'Similar conditions and about {0} less driving.', a_r_closer_line: 'Similar conditions and about {0} closer as the crow flies.', a_r_comp: 'Comparable conditions today.', a_r_pass: ' Same pass as {0}.',
  a_road_chain: 'CDOT: traction/chain law near the resort', a_road_na: 'Road reports: Colorado only (CDOT)',
  a_note: 'Closed resorts and resorts without a readable report are never suggested, however much snow they have. Snow and status come from the resorts’ own reports where available (otherwise the Open-Meteo model). Road checks in these suggestions cover Colorado only (CDOT) and are checked within ~20 km of each resort, not along your whole route. Drive times are estimates without traffic. No crowd data.',
  a_loading: 'Loading nearby resorts…'
});
Object.assign(S.zh, {
  a_h: '这里不太理想？对比附近的雪山。',
  a_lead: '{0} 附近今天看起来更好或相当的营业雪场，按滑雪日评分、从 {1} 出发的车程、雪票匹配和路况排序。',
  a_none: '附近暂时没有比 {0} 更好的选择。',
  a_none_why: '已检查可到达范围内的 {0} 个雪场：{1}。',
  a_x_closed: '{0} 个公布关闭', a_x_nr: '{0} 个没有 SkiDay 可读取的报告', a_x_worse: '{0} 个今天看起来更差', a_x_road: '{0} 个附近有 CDOT 封路或链条法规', a_x_wind: '{0} 个山顶阵风强',
  a_drive_est: '约 {0}', a_drive_osrm: '车程 · 道路估算，不含路况', a_drive_line: '车程 · 按直线粗略估算',
  a_pass_same: '同一雪票（{0}）', a_pass_diff: '不同雪票（{0}）', a_pass_ticket: '单买缆车票',
  a_terrain: '地形开放', a_snow: '24小时新雪', a_view: '查看雪况',
  a_r_open: '今天营业，缆车运行 {0}，而{1}未开放。', a_r_notlim: '开放更多：缆车 {0}，这里 {1}。',
  a_r_terrain: '地形开放 {0}，这里 {1}。', a_r_snow: '24小时新雪 {0}，这里 {1}。', a_r_lifts: '缆车运行 {0}，这里 {1}。',
  a_r_closer: '雪况相近，车程少约 {0}。', a_r_closer_line: '雪况相近，直线距离近约 {0}。', a_r_comp: '今天雪况相当。', a_r_pass: ' 与{0}同一雪票。',
  a_road_chain: 'CDOT：雪场附近有牵引力/链条法规', a_road_na: '路况：仅覆盖科罗拉多（CDOT）',
  a_note: '无论降雪多少，都不会推荐已关闭或没有可读取报告的雪场。降雪和营业状态尽量来自雪场自己的报告（否则用 Open-Meteo 模型）。这些推荐里的路况检查只覆盖科罗拉多（CDOT），检查的是每个雪场约 20 公里范围内，而不是你的整条路线。车程为不含路况的估算。没有人流数据。',
  a_loading: '正在加载附近雪场…'
});
// Basic resort pages on the shared resort-page layout — stage 2.
Object.assign(S.en, {
  b_temp_now: 'Summit temp now · forecast', b_new_mod: 'New snow 24 h · model', b_new_rep: 'New snow 24 h · resort', b_lifts: 'Lifts operating', b_runs: 'Runs open', b_terrain: 'Terrain open', b_base: 'Base depth · resort',
  b_src_rep: 'Lifts, runs, terrain, base and new snow: {0}, updated {1}. Temperature: Open-Meteo model at the summit ({2}).',
  b_src_none: 'SkiDay can’t read a lift or terrain report for this resort, so those show “Not reported”. New snow and temperature: Open-Meteo model at the summit ({0}).',
  b_norep: 'SkiDay can’t read this resort’s lift and terrain report. Check the official snow report.', b_nostatus: 'The resort’s report doesn’t say whether lifts are running.',
  b_noroads: 'No road reports here: SkiDay’s live road data covers Colorado, Utah, California and the Northeast. Check the state DOT or 511 before you go.',
  b_roads_out: 'Road reports', b_roads_out_v: 'Colorado only (CDOT)', b_traffic_link: 'Check live traffic in Google Maps', b_drive_src: 'Drive: OSRM road-network estimate from {0}.',
  b_heavy: 'Heavy snow today: {0}, expect slow driving', b_nws: 'Weather alerts (National Weather Service) are only checked on SkiDay’s full dashboards.',
  b_rest_co: 'CDOT road data and the Open-Meteo forecast', b_rest: 'the Open-Meteo forecast', b_map: 'Route map', b_wait_route: 'Waiting for the drive estimate', b_wx_wait: 'Forecast loading…'
});
Object.assign(S.zh, {
  b_temp_now: '山顶现在 · 预报', b_new_mod: '24小时新雪 · 模型', b_new_rep: '24小时新雪 · 雪场', b_lifts: '缆车运行', b_runs: '雪道开放', b_terrain: '地形开放', b_base: '雪底深度 · 雪场',
  b_src_rep: '缆车、雪道、地形、雪底和新雪：{0}，更新于 {1}。气温：Open-Meteo 模型（山顶，{2}）。',
  b_src_none: 'SkiDay 读取不到此雪场的缆车或地形报告，所以显示“未公布”。新雪和气温：Open-Meteo 模型（山顶，{0}）。',
  b_norep: 'SkiDay 读取不到此雪场的缆车和地形报告。请查看官方雪况报告。', b_nostatus: '雪场报告没有说明缆车是否运行。',
  b_noroads: '这里没有路况：SkiDay 的实时路况数据覆盖科罗拉多、犹他、加州和东北地区。出发前请查看当地交通部门或 511。',
  b_roads_out: '路况', b_roads_out_v: '仅科罗拉多（CDOT）', b_traffic_link: '在 Google 地图查看实时路况', b_drive_src: '车程：OSRM 道路网络估算，从 {0} 出发。',
  b_heavy: '今天大雪：{0}，开车会慢', b_nws: '天气预警（美国国家气象局）只在 SkiDay 的完整看板中检查。',
  b_rest_co: 'CDOT 路况和 Open-Meteo 预报', b_rest: 'Open-Meteo 预报', b_map: '路线地图', b_wait_route: '等待车程估算', b_wx_wait: '正在加载预报…'
});
const STATE_NAMES = { CO: 'Colorado', UT: 'Utah', CA: 'California', NV: 'Nevada', 'CA/NV': 'California Nevada', WA: 'Washington', OR: 'Oregon', AK: 'Alaska', WY: 'Wyoming', MT: 'Montana', ID: 'Idaho', NM: 'New Mexico', AB: 'Alberta', BC: 'British Columbia', QC: 'Quebec', ON: 'Ontario', VT: 'Vermont', ME: 'Maine', NH: 'New Hampshire', NY: 'New York' };
const STATE_ZH = { CO: '科罗拉多', UT: '犹他', CA: '加州', NV: '内华达', 'CA/NV': '加州 内华达', WA: '华盛顿州', OR: '俄勒冈', AK: '阿拉斯加', WY: '怀俄明', MT: '蒙大拿', ID: '爱达荷', NM: '新墨西哥', AB: '阿尔伯塔', BC: '不列颠哥伦比亚', QC: '魁北克', ON: '安大略', VT: '佛蒙特', ME: '缅因', NH: '新罕布什尔', NY: '纽约' };

let X = null;                      // context from app.js
const D = {
  cat: null, byId: new Map(), cond: null, condAt: 0, tab: 'best', q: '', sort: 'score', view: 'list',
  f: { region: '', pass: '', status: '', dist: '' }, cmp: [], drive: {}, driveKey: '', map: null, markers: null, acIdx: -1, searched: false,
  basic: { id: null, fc: null, fcErr: null, route: null, routeErr: null, point: 'summit', map: null }
};
const $ = s => document.querySelector(s);
const tr = (k, ...a) => { let s = (S[X.state.lang] || S.en)[k] ?? S.en[k] ?? k; a.forEach((v, i) => { s = s.replace(`{${i}}`, v); }); return s; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const U = () => X.state.units;
const LSd = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem('ski.' + k)); return Array.isArray(d) ? (Array.isArray(v) ? v : d) : (v ?? d); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('ski.' + k, JSON.stringify(v)); } catch {} }
};
const favs = () => LSd.get('favs', []).filter(id => D.byId.has(id));
const recents = () => LSd.get('recent', []).filter(id => D.byId.has(id));
export const catalogResort = id => D.byId.get(id) || null;
/** The resort's own lift/terrain/snow report as fetched for the catalog (null when none / not loaded). */
export const catalogReport = id => D.cond?.reports?.[id] || null;

/* ---------- distance / drive / score ---------- */
function hav(a, b) {
  const R = 6371, rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const startPt = () => X.getStart();
const distKm = r => hav(startPt(), r);
const kmTxt = km => U() === 'imperial' ? `${Math.round(km / 1.609)} mi` : `${Math.round(km)} km`;
const durTxt = m => X.state.lang === 'zh' ? `${Math.floor(m / 60)}小时${String(m % 60).padStart(2, '0')}分` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const cond = r => D.cond?.resorts?.[r.id] || null;
const report = r => D.cond?.reports?.[r.id] || null;
const rep24 = p => p ? (p.s24Cm ?? p.snow24 ?? null) : null;      // resort-reported 24 h snow (cm)
const snow24 = r => rep24(report(r)) ?? cond(r)?.summit.s24 ?? null;
const baseCm = r => report(r)?.baseCm ?? null;
const pctOpen = r => report(r)?.pct ?? null;
let mxMemo = { at: -1 };
function maxima() {
  if (mxMemo.at === D.condAt) return mxMemo;
  const rs = Object.values(D.cond?.reports || {});
  mxMemo = { at: D.condAt, base: Math.max(25, ...rs.map(p => p.baseCm ?? 0)), pct: Math.max(1, ...rs.map(p => p.pct ?? 0)) };
  return mxMemo;
}
function score(r) {
  const c = cond(r); if (!c) return null;
  const s24 = (snow24(r) ?? 0) / 2.54, s72 = (c.summit.s72 ?? 0) / 2.54;
  const snow = Math.min(35, s24 * 4 + s72 * 1.5);
  // Base and terrain are scored against the best any resort reports today (early season 9% open can be the best there is).
  const mx = maxima();
  const b = baseCm(r), base = b == null ? 7.5 : 15 * Math.min(1, b / mx.base);
  const pc = pctOpen(r), terrain = pc == null ? 10 : 20 * Math.min(1, pc / mx.pct);
  const tf = c.summit.t == null ? null : c.summit.t * 9 / 5 + 32;
  const temp = tf == null ? 2.5 : tf < 15 ? Math.max(0, 5 - (15 - tf) * 0.2) : tf > 30 ? Math.max(0, 5 - (tf - 30) * 0.4) : 5;
  const wm = c.summit.wind == null ? null : c.summit.wind / 1.609;
  const wind = wm == null ? 5 : wm <= 10 ? 10 : wm >= 40 ? 0 : 10 * (40 - wm) / 30;
  const km = distKm(r), dist = km <= 100 ? 15 : km >= 800 ? 0 : 15 * (800 - km) / 700;
  let s = snow + base + terrain + temp + wind + dist;
  if (report(r)?.status === 'closed') s *= 0.3;
  return { total: Math.round(s), snow: Math.round(snow), base: Math.round(base), terrain: Math.round(terrain), weather: Math.round(temp + wind), dist: Math.round(dist) };
}

/* ---------- search ---------- */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u4e00-\u9fff ]+/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
function buildIndex() {
  const reg = Object.fromEntries(D.cat.regions.map(g => [g.id, g]));
  for (const r of D.cat.resorts) {
    const f = [[r.name, 10], ...r.aliases.map(a => [a, 8]), [r.city, 6], [`${r.state} ${STATE_NAMES[r.state] || ''} ${STATE_ZH[r.state] || ''}`, 5],
      [`${reg[r.region]?.en || ''} ${reg[r.region]?.zh || ''}`, 4], [r.range, 4], [r.passes.length ? r.passes.map(p => `${p} pass`).join(' ') : 'other independent', 3]];
    r._ix = f.map(([s, w]) => { const n = norm(s); return { n, words: n.split(' '), w }; });
  }
}
function matchScore(r, q) {
  const toks = norm(q).split(' ').filter(Boolean); if (!toks.length) return 0;
  let total = 0;
  for (const tk of toks) {
    let best = 0;
    for (const f of r._ix) {
      if (!f.n) continue;
      let s = 0;
      if (f.words.some(w => w.startsWith(tk))) s = 1;
      else if (f.n.includes(tk)) s = 0.7;
      else if (tk.length >= 4) { const max = tk.length >= 5 ? 2 : 1; if (f.words.some(w => w.length >= 4 && (lev(tk, w.slice(0, tk.length), max) <= max || lev(tk, w.slice(0, tk.length + 1), max) <= max || lev(tk, w, max) <= max))) s = 0.5; }
      best = Math.max(best, s * f.w);
    }
    if (!best) return 0;
    total += best;
  }
  if (norm(r.name).startsWith(norm(q))) total += 5;
  return total;
}
function search(q) {
  return D.cat.resorts.map(r => [r, matchScore(r, q)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

/* ---------- data ---------- */
export async function loadCatalog() {
  if (D.cat) return D.cat;
  D.cat = await X.getJson(`data/catalog.json?v=${Math.floor(Date.now() / 600000)}`);
  D.cat.resorts.forEach(r => D.byId.set(r.id, r));
  buildIndex();
  return D.cat;
}
export async function loadConditions(force) {
  if (!force && D.cond && Date.now() - D.condAt < 5 * 60e3) return D.cond;
  try { D.cond = await X.getJson(`api/catalog-conditions.json?v=${Math.floor(Date.now() / 60000)}`, 15000); D.condAt = Date.now(); }
  catch (e) { console.warn('[ski] catalog conditions unavailable', e); }
  return D.cond;
}
/** Resolve ?resort= values: id, or an exact name/alias. */
export function resolveResort(v) {
  if (!v || !D.cat) return null;
  if (D.byId.has(v)) return D.byId.get(v);
  const n = norm(v);
  return D.cat.resorts.find(r => norm(r.name) === n || r.aliases.some(a => norm(a) === n)) || null;
}
export function addRecent(id) { const r = [id, ...LSd.get('recent', []).filter(x => x !== id && typeof x === 'string')].slice(0, 8); LSd.set('recent', r); }
function toggleFav(id) {
  const f = favs(); const on = f.includes(id);
  LSd.set('favs', on ? f.filter(x => x !== id) : [...f, id]);
  X.track('disc_fav', on ? 'remove' : 'add', { resort_id: id });
}

/* ---------- formatting ---------- */
function updTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return '—';
  const loc = X.state.lang === 'zh' ? 'zh-CN' : 'en-US';
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(loc, today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}
const passTxt = r => r.passes.length ? r.passes.map(p => p[0].toUpperCase() + p.slice(1)).join(' · ') : tr('d_other');
const stateTxt = r => X.state.lang === 'zh' ? (STATE_ZH[r.state] || r.state) : (STATE_NAMES[r.state] ? r.state : r.state);
const regionName = id => { const g = D.cat.regions.find(x => x.id === id); return g ? (g[X.state.lang] || g.en) : id; };
/** Operating status from the resort's own report (lift counts), kept apart from the season line below.
 *  green = open, amber = open but limited (<25% of lifts, same threshold as the full dashboards), red = closed, gray = not reported. */
function opStatus(r) {
  const p = report(r);
  if (!p?.status) return { cls: 'na', label: tr('c_nr') };
  if (p.status === 'closed') return { cls: 'nogo', label: tr('c_closed') };
  const lim = p.lifts?.total && p.lifts.open / p.lifts.total < 0.25;
  return { cls: lim ? 'caution' : 'go', label: tr(lim ? 'c_limited' : 'c_open') };
}
function statusHtml(r) {
  const p = report(r), o = opStatus(r);
  const lifts = p?.lifts?.total ? ` · ${esc(tr('c_lifts', p.lifts.open, p.lifts.total))}` : '';
  return `<span class="dst s-${o.cls}"><i aria-hidden="true"></i>${esc(o.label)}${lifts}</span>`;
}
/** Season line: what the report says about the season, separate from how many lifts run today. */
function seasonTxt(r) {
  const p = report(r);
  if (!p?.status) return tr('c_season_nr');
  if (p.status === 'open') return tr('c_season_open');
  const at = p.at ? new Date(p.at) : null;
  if (at && !isNaN(at) && Date.now() - at > 21 * 864e5) return tr('c_season_old', new Intl.DateTimeFormat(X.state.lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: at.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(at));
  return tr('c_season_rep', updTime(p.at || p.fetchedAt));
}
const baseTxt = (cm, u) => cm == null ? null : u === 'imperial' ? `${Math.round(cm / 2.54)}″` : `${Math.round(cm)} cm`;
const nf0 = n => Number(n).toLocaleString(X.state.lang === 'zh' ? 'zh-CN' : 'en-US');
function terrainTip(p) {
  if (!p || p.pct == null) return '';
  return p.basis === 'acres' && p.acres ? tr('d_acres', nf0(p.acres.open), nf0(p.acres.total)) : p.trails ? tr('d_trails', nf0(p.trails.open), nf0(p.trails.total)) : '';
}
const nr = () => `<b class="nr">${esc(tr('d_nr'))}</b>`;
/** When the numbers on a card were last updated: the resort report's own time if it has one, else the model run. */
function cardUpd(r) {
  const p = report(r), c = cond(r);
  const t = p ? ([p.at, p.snowAt].filter(Boolean).sort().pop() || p.fetchedAt) : c?.at;
  return t ? tr('d_upd', updTime(t)) : '';
}
const pctTxt = p => p?.pct == null ? null : p.pct === 0 && p.trails?.open > 0 ? tr('c_lt1') : `${p.pct}%`;
function statsHtml(r, u) {
  const c = cond(r), p = report(r), s24 = snow24(r), rep = rep24(p) != null, b = baseCm(r), pt = pctTxt(p);
  const cell = (val, label, title = '') => `<span${title ? ` title="${esc(title)}"` : ''}>${val != null ? `<b>${val}</b>` : nr()}<small>${esc(label)}</small></span>`;
  return cell(s24 != null ? fmt.snow(s24, u) : null, tr(rep ? 'c_new_rep' : 'c_new_mod'))
    + cell(b != null ? baseTxt(b, u) : null, tr('d_base'), b != null ? tr('d_rep') : '')
    + cell(pt, tr('d_terrain'), terrainTip(p))
    + cell(c?.summit?.s72 != null ? fmt.snow(c.summit.s72, u) : null, tr('d_fc72'))
    + cell(p?.lifts?.total ? `${p.lifts.open}<small>/${p.lifts.total}</small>` : null, tr('c_lifts_s'));
}
/** Score breakdown (ⓘ): what lifts the score and what holds it back. Scoring itself is unchanged (see score()). */
const SCORE_MAX = { snow: 35, base: 15, terrain: 20, weather: 15, dist: 15 };
function scoreWhy(r, sc) {
  const halfB = baseCm(r) == null, halfT = pctOpen(r) == null;
  const rows = [['snow', sc.snow], ['base', sc.base, halfB], ['terrain', sc.terrain, halfT], ['weather', sc.weather], ['dist', sc.dist]].map(([k, v, half]) => {
    const f = v / SCORE_MAX[k], cls = half ? 'mid' : f >= 0.6 ? 'pos' : f <= 0.35 ? 'neg' : 'mid';
    return { cls, html: `<li class="x-${cls}"><span>${cls === 'pos' ? '+' : cls === 'neg' ? '−' : '•'}</span>${esc(tr('x_' + k))} <b>${v}/${SCORE_MAX[k]}</b>${half ? ` <small>(${esc(tr('x_half'))})</small>` : ''}</li>` };
  });
  const grp = (cls, k) => { const l = rows.filter(x => x.cls === cls); return l.length ? `<p class="x-h">${esc(tr(k))}</p><ul>${l.map(x => x.html).join('')}</ul>` : ''; };
  return `<details class="dsx"><summary aria-label="${esc(tr('c_score_why'))}" title="${esc(tr('c_score_why'))}">ⓘ</summary><div class="dsx-p" role="note">
    <b>${sc.total}/100 · ${esc(tr('d_score'))}</b>${grp('pos', 'x_pos')}${grp('neg', 'x_neg')}${grp('mid', 'x_mid')}
    ${report(r)?.status === 'closed' ? `<p class="x-cl">${esc(tr('x_closed'))}</p>` : ''}<p class="small muted">${esc(tr('x_season'))}</p></div></details>`;
}
const photoStyle = r => r.photo?.src ? ` style="background-image:url('${esc(r.photo.src)}')"` : '';

function card(r, { rank } = {}) {
  const c = cond(r), u = U(), f = favs().includes(r.id), sc = score(r);
  return `<article class="dcard" data-open="${r.id}" data-id="${r.id}">
    <div class="dph${r.photo ? '' : ' ph0'}"${photoStyle(r)}>${rank ? `<span class="drank">${rank}</span>` : ''}${r.detail === 'full' ? `<span class="dfull">${esc(tr('d_full'))}</span>` : ''}</div>
    <div class="dbody">
      <div class="dhead"><div class="dtt"><h3>${esc(r.name)}</h3>
        <div class="dmeta">${esc(regionName(r.region))} · ${esc(stateTxt(r))} · <span class="dpass">${esc(passTxt(r))}</span></div></div>
        ${sc ? `<div class="dscore"><b>${sc.total}</b><small>${esc(tr('d_score'))}</small>${scoreWhy(r, sc)}</div>` : ''}
        <button type="button" class="dfav${f ? ' on' : ''}" data-fav="${r.id}" aria-pressed="${f}" aria-label="${esc(tr(f ? 'd_remfav' : 'd_addfav'))}" title="${esc(tr(f ? 'd_remfav' : 'd_addfav'))}">${f ? '★' : '☆'}</button></div>
      <div class="dfoot">${statusHtml(r)}<span class="dseason">${esc(seasonTxt(r))}</span></div>
      <div class="dstats">${statsHtml(r, u)}</div>
      <div class="dact"><button type="button" class="dgo" data-open="${r.id}">${esc(tr('d_view'))} →</button>
        <label class="dcmp"><input type="checkbox" data-cmp="${r.id}"${D.cmp.includes(r.id) ? ' checked' : ''}${!D.cmp.includes(r.id) && D.cmp.length >= 4 ? ' disabled' : ''}> ${esc(tr('d_compare'))}</label>
        <span class="dupd">${c || report(r) ? esc(cardUpd(r)) : ''}</span></div>
    </div>
  </article>`;
}

/* ---------- list building ---------- */
function filtered(list) {
  const f = D.f;
  return list.filter(r => (!f.region || r.region === f.region)
    && (!f.pass || (f.pass === 'other' ? !r.passes.length : r.passes.includes(f.pass)))
    && (!f.status || (f.status === 'open' ? report(r)?.status === 'open' : report(r)?.status !== 'closed'))
    && (!f.dist || distKm(r) <= +f.dist));
}
const SORTS = {
  score: (a, b) => (score(b)?.total ?? -1) - (score(a)?.total ?? -1),
  snow: (a, b) => (snow24(b) ?? -1) - (snow24(a) ?? -1) || SORTS.score(a, b),
  close: (a, b) => distKm(a) - distKm(b),
  fcst: (a, b) => (cond(b)?.summit.s72 ?? -1) - (cond(a)?.summit.s72 ?? -1),
  base: (a, b) => (baseCm(b) ?? -1) - (baseCm(a) ?? -1) || SORTS.score(a, b),
  terrain: (a, b) => (pctOpen(b) ?? -1) - (pctOpen(a) ?? -1) || (report(b)?.acres?.open ?? report(b)?.trails?.open ?? 0) - (report(a)?.acres?.open ?? report(a)?.trails?.open ?? 0) || SORTS.score(a, b),
  open: (a, b) => ((report(b)?.status === 'open') - (report(a)?.status === 'open')) || SORTS.score(a, b)
};
function currentList() {
  const all = D.cat.resorts;
  if (D.q.trim()) {
    const hits = search(D.q);
    return { title: tr('d_results', esc(D.q.trim())), list: filtered(hits), ranked: false };
  }
  if (D.tab === 'fav') return { title: tr('d_fav'), list: filtered(favs().map(id => D.byId.get(id))), empty: tr('d_fav_empty') };
  if (D.tab === 'near') return { title: tr('d_near_h'), list: filtered([...all].sort(SORTS.close)), note: tr('d_drive_note', X.L(startPt().name) || '') };
  if (D.tab === 'explore') return { title: tr('d_explore_h'), list: filtered(all), grouped: true };
  return { title: tr('d_best_near'), list: filtered([...all].sort(SORTS[D.sort] || SORTS.score)), ranked: true, sortable: true, note: tr('d_best_note', X.L(startPt().name) || '') };
}

/* ---------- render ---------- */
function opt(v, label, cur) { return `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`; }
function renderShell() {
  const el = $('#discover'); if (!el) return;
  if (!el.querySelector('#d-list')) {
    el.innerHTML = `<div class="disc-hero"><div class="wrap">
        <h1 class="q" id="d-title"></h1><p class="dsub" id="d-sub"></p>
        <div class="dsearch"><span aria-hidden="true">🔎</span><input id="dq" type="search" autocomplete="off" enterkeyhint="search" aria-autocomplete="list" aria-controls="dq-ac"><button type="button" class="dqx" id="dq-x" hidden aria-label="Clear">✕</button><ul class="ac" id="dq-ac" role="listbox" hidden></ul></div>
        <div class="dhero-a"><p class="dfrom" id="d-from"></p><a class="dplan" id="d-plan" href="?plan=1" data-plan></a></div>
        <div class="dtabs-row"><div class="dtabs" id="d-tabs" role="tablist"></div></div>
      </div></div>
      <div class="wrap dwrap">
        <div class="drecent" id="d-recent"></div>
        <div class="dbar" id="d-bar"></div>
        <div class="dsplit" id="d-split">
          <div class="dlist" id="d-list" aria-live="polite"></div>
          <div class="dmapwrap" id="d-mapwrap"><button type="button" class="dmapx" id="d-mapx">✕ ${''}</button><div id="d-map" class="dmap"></div></div>
        </div>
        <details class="dcredits" id="d-credits"></details>
      </div>
      <div class="dtray" id="d-tray" hidden></div>
      <div class="dmodal" id="d-modal" hidden></div>`;
    el.dataset.ready = '1';
    bindShell();
  }
  $('#d-title').textContent = tr('d_title');
  $('#d-sub').textContent = tr('d_sub');
  $('#dq').placeholder = tr('d_search');
  if ($('#dq').value !== D.q) $('#dq').value = D.q;
  $('#dq-x').hidden = !D.q;
  const s = startPt();
  const ipLoc = s.kind === 'auto-ip' && s.where;
  $('#d-from').innerHTML = `📍 ${esc(tr('d_from'))} <b>${esc(ipLoc ? s.where : (X.L(s.name) || ''))}</b>${ipLoc ? ` <span class="dapprox">${esc(tr('d_approx'))}</span>` : ''} · <button type="button" class="dlink" id="d-loc">${esc(tr('d_useloc'))}</button> <span id="d-locmsg" class="muted"></span>`;
  // Best Conditions first (the default), then Explore, Near Me, Favorites.
  const tabs = [['best', '❄️', 'd_best'], ['explore', '🗺️', 'd_explore'], ['near', '📍', 'd_near'], ['fav', '⭐', 'd_fav']];
  $('#d-plan').textContent = `🧭 ${tr('d_plan')} →`;
  $('#d-tabs').innerHTML = tabs.map(([id, ic, k]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${D.tab === id && !D.q}" class="${D.tab === id && !D.q ? 'on' : ''}"><i aria-hidden="true">${ic}</i>${esc(tr(k))}${id === 'fav' && favs().length ? ` <small>${favs().length}</small>` : ''}</button>`).join('');
  $('#d-mapx').textContent = `☰ ${tr('d_list')}`;
  const ph = D.cat.resorts.filter(r => r.photo);
  $('#d-credits').innerHTML = `<summary>📷 ${X.state.lang === 'zh' ? '照片署名' : 'Photo credits'} (${ph.length})</summary><ul>${ph.map(r => `<li>${esc(r.name)}: ${esc(r.photo.credit)} · <a href="${esc(r.photo.page)}" target="_blank" rel="noopener">${esc(r.photo.license)}</a></li>`).join('')}</ul>`;
}
function renderRecent() {
  const r = recents();
  $('#d-recent').innerHTML = r.length ? `<h2 class="ov">${esc(tr('d_recent'))}</h2><div class="rvchips">${r.map(id => { const x = D.byId.get(id); const c = cond(x);
    return `<button type="button" class="rvchip" data-open="${id}"><span class="rvchip-ph${x.photo ? '' : ' ph0'}"${photoStyle(x)}></span><span><b>${esc(x.name)}</b><small>${esc(stateTxt(x))} · ${c ? `${fmt.snow(snow24(x), U())} ${esc(tr('d_new'))}${baseCm(x) != null ? ` · ${baseTxt(baseCm(x), U())} ${esc(tr('d_base'))}` : ''}` : esc(passTxt(x))}</small></span></button>`; }).join('')}</div>` : '';
}
function renderBar(meta) {
  const im = U() === 'imperial', f = D.f;
  const dists = im ? [[161, '100 mi'], [402, '250 mi'], [805, '500 mi']] : [[150, '150 km'], [400, '400 km'], [800, '800 km']];
  const nf = ['region', 'pass', 'status', 'dist'].filter(k => f[k]).length;
  $('#d-bar').classList.toggle('fopen', !!D.fopen);
  $('#d-bar').innerHTML = `
    <button type="button" class="dftog" data-ftog aria-expanded="${!!D.fopen}">⚙︎ ${esc(tr('d_filters'))}${nf ? ` <b>${nf}</b>` : ''}</button>
    <label class="ff"><span>${esc(tr('d_region'))}</span><select data-f="region">${opt('', tr('d_allr'), f.region)}${D.cat.regions.map(g => opt(g.id, `${g[X.state.lang] || g.en} (${D.cat.resorts.filter(r => r.region === g.id).length})`, f.region)).join('')}</select></label>
    <label class="ff"><span>${esc(tr('d_pass'))}</span><select data-f="pass">${opt('', tr('d_allp'), f.pass)}${opt('ikon', 'Ikon', f.pass)}${opt('epic', 'Epic', f.pass)}${opt('indy', 'Indy', f.pass)}${opt('other', tr('d_other'), f.pass)}</select></label>
    <label class="ff"><span>${esc(tr('d_status'))}</span><select data-f="status">${opt('', tr('d_any'), f.status)}${opt('open', tr('d_open_only'), f.status)}${opt('notclosed', tr('d_hide_closed'), f.status)}</select></label>
    <label class="ff"><span>${esc(tr('d_dist'))}</span><select data-f="dist">${opt('', tr('d_any'), f.dist)}${dists.map(([v, l]) => opt(v, tr('d_within', l), f.dist)).join('')}</select></label>
    ${meta.sortable ? `<label><span>${esc(tr('d_sort'))}</span><select id="d-sort">${['score', 'snow', 'fcst', 'base', 'terrain', 'open', 'close'].map(k => opt(k, tr('s_' + k), D.sort)).join('')}</select></label>` : ''}
    <details class="dhelp"><summary>ⓘ ${esc(tr('d_score'))}</summary><p>${esc(tr('d_score_help'))}</p><p class="small muted">${esc(tr('d_model'))}</p></details>
    <div class="dvt" role="group" aria-label="${esc(tr('d_list'))} / ${esc(tr('d_map'))}"><button type="button" data-vt="list" class="${D.view === 'list' ? 'on' : ''}">☰ ${esc(tr('d_list'))}</button><button type="button" data-vt="map" class="${D.view === 'map' ? 'on' : ''}">🗺️ ${esc(tr('d_map'))}</button></div>`;
}
function renderList() {
  const meta = currentList();
  renderBar(meta);
  let html = `<div class="dlist-h"><h2>${meta.title}</h2><span class="muted small">${esc(tr('d_nresorts', meta.list.length))}</span></div>`;
  if (!D.cond) html += `<p class="dnote-w">${esc(tr('d_cond_na'))}</p>`;
  if (meta.note) html += `<p class="small muted">${esc(meta.note)}</p>`;
  if (!meta.list.length) html += `<p class="dempty">${esc(meta.empty && !D.q ? meta.empty : tr('d_none'))}</p>`;
  else if (meta.grouped) {
    const groups = D.cat.regions.map(g => [g, meta.list.filter(r => r.region === g.id)]).filter(x => x[1].length);
    html += `<div class="dregions">${groups.map(([g, l]) => { const ph = l.find(r => r.photo);
      return `<button type="button" class="dreg" data-region="${g.id}"><span class="dreg-ph${ph ? '' : ' ph0'}"${ph ? photoStyle(ph) : ''}></span><b>${esc(g[X.state.lang] || g.en)}</b><small>${esc(tr('d_nresorts', l.length))}</small></button>`; }).join('')}</div>`;
    html += groups.map(([g, l]) => `<h3 class="dgrp" id="dg-${g.id}">${esc(g[X.state.lang] || g.en)} <small class="muted">${l.length}</small></h3><div class="dcards">${l.slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => card(r)).join('')}</div>`).join('');
  } else {
    if (D.q.trim() && meta.list[0]) {
      const top = meta.list[0];
      const near = D.cat.resorts.filter(r => r !== top && !meta.list.slice(0, 6).includes(r) && hav(top, r) < 200).sort((a, b) => hav(top, a) - hav(top, b)).slice(0, 3);
      html += `<div class="dcards">${meta.list.slice(0, 30).map(r => card(r)).join('')}</div>`;
      if (near.length) html += `<h3 class="dgrp">${esc(tr('d_nearby', top.name))}</h3><div class="dcards">${near.map(r => card(r)).join('')}</div>`;
    } else html += `<div class="dcards">${meta.list.map((r, i) => card(r, { rank: meta.ranked && D.sort === 'score' && i < 3 ? i + 1 : 0 })).join('')}</div>`;
  }
  $('#d-list').innerHTML = html;
  renderTray();
  if (D.map) drawMarkers(meta.list);
}
function renderTray() {
  const t = $('#d-tray'); if (!t) return;
  t.hidden = D.cmp.length < 1;
  t.innerHTML = `<span>${D.cmp.map(id => esc(D.byId.get(id).name)).join(' · ')}</span><button type="button" class="dgo" data-cmpopen ${D.cmp.length < 2 ? 'disabled' : ''}>${esc(tr('d_compare_n', D.cmp.length))}</button><button type="button" class="dlink" data-cmpclear>${esc(tr('d_clear'))}</button>`;
}
function renderCompare() {
  const rs = D.cmp.map(id => D.byId.get(id)), u = U();
  const row = (label, fn) => `<tr><th>${esc(label)}</th>${rs.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`;
  $('#d-modal').innerHTML = `<div class="dmodal-in" role="dialog" aria-modal="true" aria-label="${esc(tr('d_cmp_h'))}"><div class="dmodal-h"><h2>${esc(tr('d_cmp_h'))}</h2><button type="button" class="dlink" data-cmpclose>✕ ${esc(tr('d_close'))}</button></div>
    <div class="dtable"><table><thead><tr><th></th>${rs.map(r => `<th><a href="?resort=${r.id}" data-open="${r.id}">${esc(r.name)}</a></th>`).join('')}</tr></thead><tbody>
    ${row(tr('d_region'), r => `${esc(regionName(r.region))} · ${esc(r.state)}`)}
    ${row(tr('d_pass'), r => esc(passTxt(r)))}
    ${row(tr('d_score'), r => { const s = score(r); return s ? `<b>${s.total}</b>/100` : '—'; })}
    ${row(tr('d_status'), r => `${statusHtml(r)}<br><small class="muted">${esc(seasonTxt(r))}</small>`)}
    ${row(tr('d_new'), r => { const v = snow24(r); return v == null ? '—' : `${fmt.snow(v, u)}${rep24(report(r)) != null ? ' ✓' : ''}`; })}
    ${row(tr('d_base'), r => baseCm(r) != null ? `<b>${baseTxt(baseCm(r), u)}</b>` : `<span class="muted">${esc(tr('d_nr'))}</span>`)}
    ${row(tr('d_terrain'), r => pctOpen(r) != null ? `<b>${pctTxt(report(r))}</b> <small class="muted">${esc(terrainTip(report(r)))}</small>` : `<span class="muted">${esc(tr('d_nr'))}</span>`)}
    ${row(tr('d_fc72'), r => cond(r) ? fmt.snow(cond(r).summit.s72, u) : '—')}
    ${row(tr('d_temp'), r => cond(r) ? fmt.temp(cond(r).summit.t, u) : '—')}
    ${row(tr('d_wind'), r => cond(r) ? `${fmt.wind(cond(r).summit.wind, u)} <small class="muted">(${fmt.wind(cond(r).summit.gust, u)})</small>` : '—')}
    ${row(tr('d_dist_start'), r => `${kmTxt(distKm(r))} <small class="muted">${esc(tr('d_straight'))}</small>`)}
    ${row(tr('b_elev'), r => fmt.elevRange(r.baseElevM, r.summitElevM, u))}
    ${row(tr('d_upd', '').trim() || 'Updated', r => esc(cardUpd(r).replace(tr('d_upd', ''), '').trim() || '—'))}
    </tbody></table></div><p class="small muted">${esc(tr('d_model'))} ✓ = ${X.state.lang === 'zh' ? '雪场公布' : 'resort-reported'}</p></div>`;
  $('#d-modal').hidden = false;
  X.track('disc_compare', 'open'); X.compare?.(D.cmp);
}

/* ---------- map ---------- */
function miniCard(r) {
  const u = U(), f = favs().includes(r.id), p = report(r), s24 = snow24(r), b = baseCm(r), pt = pctTxt(p), sc = score(r);
  const bits = [s24 != null ? `❄️ ${fmt.snow(s24, u)} ${esc(tr(rep24(p) != null ? 'c_new_rep' : 'c_new_mod'))}` : null, b != null ? `${baseTxt(b, u)} ${esc(tr('d_base'))}` : null, pt ? `${pt} ${esc(tr('d_terrain'))}` : null].filter(Boolean);
  return `<div class="dmini"><span class="dmini-h"><b>${esc(r.name)}</b>${sc ? `<em class="dmini-sc">${sc.total}</em>` : ''}</span><span class="muted">${esc(regionName(r.region))} · ${esc(stateTxt(r))} · ${esc(passTxt(r))}</span>
    ${statusHtml(r)}
    <span>${bits.join(' · ') || `<span class="muted">${esc(tr('d_nr'))}</span>`}</span>
    <span class="muted small">${esc(cardUpd(r))}</span>
    <span class="dmini-a"><button type="button" class="dgo" data-open="${r.id}">${esc(tr('d_view'))}</button><button type="button" class="dlink" data-fav="${r.id}">${f ? '★ ' + esc(tr('d_remfav')) : '☆ ' + esc(tr('d_addfav'))}</button></span></div>`;
}
function drawMarkers(list, force) {
  const Lf = window.L; if (!Lf || !D.map) return;
  // Redraw (and refit) only when the set of resorts or favorites changes, so background updates never move the map.
  const key = list.map(r => r.id).sort().join(',') + '|' + favs().join(',') + '|' + (D.cond ? D.condAt : 0) + '|' + startPt().lat + ',' + startPt().lon;
  if (!force && key === D.mkKey) return;
  const refit = !force && key.split('|')[0] !== (D.mkKey || '').split('|')[0];
  D.mkKey = key; D.mkList = list;
  if (refit && list.length) {
    // Ranked tabs: frame the top of the list (and the start point); otherwise everything shown.
    const s = startPt();
    const ranked = !D.q.trim() && (D.tab === 'best' || D.tab === 'near');
    let sel = ranked ? list.slice(0, 10) : list;
    const near = sel.filter(r => distKm(r) < 1500);       // keep a far outlier (e.g. Alaska) from zooming the map out to a continent
    if (near.length >= 2) sel = near;
    const pts = sel.map(r => [r.lat, r.lon]);
    if (ranked) pts.push([s.lat, s.lon]);
    try { D.map.fitBounds(Lf.latLngBounds(pts), { padding: [30, 30], maxZoom: 9, animate: false }); } catch {}
  }
  clusterDraw();
}
/** Simple screen-space clustering (no plugin): pins closer than ~40 px merge into a numbered bubble; tap it to zoom in.
 *  Re-run on every zoom. From zoom 9 up every resort gets its own pin. */
function clusterDraw() {
  const Lf = window.L; if (!Lf || !D.map || !D.mkList) return;
  D.markers.clearLayers(); D.pinOf = new Map();
  const fv = favs(), z = D.map.getZoom(), R = z >= 9 ? 0 : 40;
  const pts = D.mkList.map(r => ({ r, sc: score(r)?.total ?? -1, p: D.map.latLngToLayerPoint([r.lat, r.lon]) })).sort((a, b) => b.sc - a.sc);
  const used = new Set(), groups = [];
  pts.forEach((a, i) => {
    if (used.has(i)) return; used.add(i); const g = [a];
    if (R) pts.forEach((b, j) => { if (!used.has(j) && a.p.distanceTo(b.p) < R) { used.add(j); g.push(b); } });
    groups.push(g);
  });
  for (const g of groups) {
    if (g.length === 1) {
      const r = g[0].r, sc = g[0].sc;
      const cls = sc < 0 ? '' : sc >= 60 ? ' hi' : sc >= 40 ? ' mid' : '';
      const m = Lf.marker([r.lat, r.lon], { icon: Lf.divIcon({ className: 'dpin-w', html: `<span class="dpin${cls}${fv.includes(r.id) ? ' fav' : ''}">${fv.includes(r.id) ? '★' : '⛷️'}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: r.name, keyboard: true });
      m.bindPopup(() => miniCard(r), { maxWidth: 270, minWidth: 220 });
      m.on('click', () => hlCard(r.id));
      D.markers.addLayer(m); D.pinOf.set(r.id, m);
    } else {
      const ll = Lf.latLngBounds(g.map(x => [x.r.lat, x.r.lon]));
      const m = Lf.marker(ll.getCenter(), { icon: Lf.divIcon({ className: 'dpin-w', html: `<span class="dclu">${g.length}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }), title: g.map(x => x.r.name).join(', '), keyboard: true });
      m.on('click', () => D.map.fitBounds(ll, { padding: [50, 50], maxZoom: Math.max(z + 2, 9) }));
      D.markers.addLayer(m); g.forEach(x => D.pinOf.set(x.r.id, m));
    }
  }
  const s = startPt();
  Lf.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#25845A', fillOpacity: 1 }).bindTooltip(X.L(s.name) || '').addTo(D.markers);
  if (D.hl) hlPin(D.hl);
}
function hlPin(id) {
  D.hl = id;
  document.querySelectorAll('#d-map .dpin.on, #d-map .dclu.on').forEach(x => x.classList.remove('on'));
  const m = id && D.pinOf?.get(id); if (!m) return;
  m.getElement()?.firstElementChild?.classList.add('on'); m.setZIndexOffset(1000);
}
function hlCard(id) {
  document.querySelectorAll('.dcard.hl').forEach(x => x.classList.remove('hl'));
  const c = document.querySelector(`#d-list .dcard[data-id="${id}"]`); if (!c) return;
  c.classList.add('hl'); hlPin(id);
  if (window.matchMedia('(min-width: 980px)').matches) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function zoomRegion(id) {
  const Lf = window.L; if (!Lf || !D.map) return;
  const rs = D.cat.resorts.filter(r => r.region === id); if (!rs.length) return;
  try { D.map.fitBounds(Lf.latLngBounds(rs.map(r => [r.lat, r.lon])), { padding: [36, 36], maxZoom: 9 }); } catch {}
}
function ensureMap() {
  const wide = window.matchMedia('(min-width: 980px)').matches;
  if (!wide && D.view !== 'map') return;
  if (D.map) { setTimeout(() => D.map.invalidateSize(), 50); return; }
  X.loadLeaflet().then(Lf => {
    if (D.map) return;
    const el = $('#d-map'); if (!el) return;
    D.map = Lf.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true, tap: false });
    const fix = ' · <a href="https://www.openstreetmap.org/fixthemap">Report a map error</a>';
    Lf.tileLayer(X.state.cfg.sources.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: (X.state.cfg.sources.tilesAttribution || '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors') + fix }).addTo(D.map);
    D.markers = Lf.layerGroup().addTo(D.map);
    D.map.setView([44, -105], 4);
    D.map.on('zoomend', clusterDraw);
    drawMarkers(currentList().list);
  }).catch(() => { const el = $('#d-map'); if (el) el.innerHTML = `<p class="muted small" style="padding:16px">Map unavailable</p>`; });
}
function setView(v) {
  D.view = v; X.track('disc_view', v);
  document.body.classList.toggle('dmap-full', v === 'map' && !window.matchMedia('(min-width: 980px)').matches);
  renderBar(currentList()); ensureMap();
}

/* ---------- autocomplete ---------- */
function renderAC() {
  const ac = $('#dq-ac'); const q = D.q.trim();
  if (q.length < 2) { ac.hidden = true; return; }
  const hits = search(q).slice(0, 6);
  const items = hits.map(r => ({ r, sub: `${r.city}, ${r.state} · ${passTxt(r)}` }));
  if (hits[0]) {
    const top = hits[0];
    D.cat.resorts.filter(r => !hits.includes(r) && hav(top, r) < 150).sort((a, b) => hav(top, a) - hav(top, b)).slice(0, 2)
      .forEach(r => items.push({ r, sub: `${tr('d_nearby', top.name)} · ${kmTxt(hav(top, r))}` }));
  }
  ac.innerHTML = items.length ? items.map((x, i) => `<li role="option" data-i="${i}" data-open="${x.r.id}" class="${i === D.acIdx ? 'on' : ''}"><b>${esc(x.r.name)}</b><span>${esc(x.sub)}</span></li>`).join('') : `<li class="none">${esc(tr('d_none'))}</li>`;
  ac.hidden = false;
  ac._items = items;
}

/* ---------- events ---------- */
function bindShell() {
  const el = $('#discover');
  const q = $('#dq');
  let tm;
  q.addEventListener('input', () => {
    D.q = q.value; D.acIdx = -1; $('#dq-x').hidden = !D.q;
    if (D.q.trim() && !D.searched) { D.searched = true; X.track('disc_search', 'used'); }
    renderAC(); clearTimeout(tm); tm = setTimeout(() => { renderShell(); renderList(); }, 180);
  });
  q.addEventListener('keydown', e => {
    const ac = $('#dq-ac'); const items = ac._items || [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!items.length) return; e.preventDefault(); D.acIdx = (D.acIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; renderAC(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[D.acIdx >= 0 ? D.acIdx : 0]; if (it && !ac.hidden) { ac.hidden = true; X.open(it.r.id, 'search'); } else { ac.hidden = true; q.blur(); } }
    else if (e.key === 'Escape') { ac.hidden = true; }
  });
  q.addEventListener('blur', () => setTimeout(() => { $('#dq-ac').hidden = true; }, 200));
  q.addEventListener('focus', () => { if (D.q.trim().length >= 2) renderAC(); });
  $('#dq-ac').addEventListener('mousedown', e => e.preventDefault());
  el.addEventListener('change', e => {
    const s = e.target.closest('select[data-f]');
    if (s) { D.f[s.dataset.f] = s.value; renderList(); return; }
    if (e.target.id === 'd-sort') { D.sort = e.target.value; renderList(); return; }
    const c = e.target.closest('input[data-cmp]');
    if (c) { const id = c.dataset.cmp; D.cmp = c.checked ? [...new Set([...D.cmp, id])].slice(0, 4) : D.cmp.filter(x => x !== id); renderList(); }
  });
  el.addEventListener('click', e => {
    if (e.target.closest('input[data-cmp], label.dcmp, select, summary, .dhelp p, .dsx-p')) return;
    if (e.target.closest('[data-plan]')) { e.preventDefault(); X.plan(); return; }
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.preventDefault(); e.stopPropagation(); toggleFav(fav.dataset.fav); renderShell(); renderList(); renderRecent(); if (D.map) D.map.closePopup(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { D.tab = tab.dataset.tab; D.q = ''; $('#dq').value = ''; if (D.tab === 'best') D.sort = D.sort || 'score'; X.track('disc_tab', D.tab); renderShell(); renderList(); return; }
    const reg = e.target.closest('[data-region]');
    if (reg) { zoomRegion(reg.dataset.region); const g = $(`#dg-${reg.dataset.region}`); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('[data-ftog]')) { D.fopen = !D.fopen; renderBar(currentList()); return; }
    const vt = e.target.closest('[data-vt]');
    if (vt) { setView(vt.dataset.vt); return; }
    if (e.target.closest('#d-mapx')) { setView('list'); return; }
    if (e.target.closest('#dq-x')) { D.q = ''; $('#dq').value = ''; renderShell(); renderList(); $('#dq').focus(); return; }
    if (e.target.closest('#d-loc')) { locate(); return; }
    if (e.target.closest('[data-cmpopen]')) { renderCompare(); return; }
    if (e.target.closest('[data-cmpclear]')) { D.cmp = []; renderList(); return; }
    if (e.target.closest('[data-cmpclose]') || e.target.id === 'd-modal') { $('#d-modal').hidden = true; return; }
    const op = e.target.closest('[data-open]');
    if (op) { e.preventDefault(); $('#d-modal').hidden = true; document.body.classList.remove('dmap-full'); D.view = 'list'; X.open(op.dataset.open, op.closest('#dq-ac') ? 'search' : op.closest('#d-modal') ? 'compare' : op.closest('#d-map, .leaflet-container') ? 'map' : 'card'); }
  });
  // Card <-> map: hovering or focusing a card highlights its pin (or the cluster holding it).
  const hov = e => { const c = e.target.closest('.dcard[data-id]'); hlPin(c && e.type !== 'mouseout' && e.type !== 'focusout' ? c.dataset.id : null); };
  ['mouseover', 'mouseout', 'focusin', 'focusout'].forEach(t => $('#d-list').addEventListener(t, hov));
  // Leaflet popups live inside the map pane (still inside #discover), handled above.
  window.addEventListener('resize', () => { if (X.view() === 'disc') { if (window.matchMedia('(min-width: 980px)').matches) document.body.classList.remove('dmap-full'); ensureMap(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#d-modal').hidden) $('#d-modal').hidden = true; });
}
function locate() {
  const msg = $('#d-locmsg');
  if (!navigator.geolocation) { msg.textContent = tr('d_loc_fail'); return; }
  msg.textContent = tr('d_locating');
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);
    X.setStart({ id: 'geo', name: { en: 'My location', zh: '我的位置' }, lat, lon, kind: 'geo' });
    D.tab = 'near'; renderDiscover();
  }, () => { msg.textContent = tr('d_loc_fail'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

export function initDiscover(ctx) { X = ctx; }
export function renderDiscover() {
  if (!D.cat) return;
  renderShell(); renderRecent(); renderList(); ensureMap();
}
export function discoverState() { return D; }

/* ================= Basic resort view ================= */
function hourKey(off) { return new Date(Date.now() + off * 1000).toISOString().slice(0, 13) + ':00'; }
function dayName(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(X.state.lang === 'zh' ? 'zh-CN' : 'en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
function chart48(pt) {
  const h = pt.hourly, k = hourKey(pt.utc_offset_seconds || 0);
  let i0 = h.time.findIndex(x => x >= k); if (i0 < 0) i0 = 0;
  const idx = [...Array(48).keys()].map(i => i0 + i).filter(i => i < h.time.length);
  const im = U() === 'imperial';
  const snow = idx.map(i => (h.snowfall[i] || 0) / (im ? 2.54 : 1));
  const temp = idx.map(i => h.temperature_2m[i] == null ? null : (im ? h.temperature_2m[i] * 9 / 5 + 32 : h.temperature_2m[i]));
  const W = window.innerWidth < 600 ? 440 : 720, H = window.innerWidth < 600 ? 190 : 170, pad = 24, bw = (W - pad * 2) / idx.length;
  const smax = Math.max(im ? 0.5 : 1, ...snow), tv = temp.filter(v => v != null), tmin = Math.min(...tv), tmax = Math.max(...tv), tr0 = Math.max(1, tmax - tmin);
  const y = v => 18 + (H - 46) * (1 - (v - tmin) / tr0);
  const bars = snow.map((v, i) => { const bh = (H - 46) * v / smax; return v > 0 ? `<rect x="${pad + i * bw + 1}" y="${H - 28 - bh}" width="${Math.max(1, bw - 2)}" height="${bh}" rx="2" fill="#7fb2d9"><title>${fmt.snow(v * (im ? 2.54 : 1), U())}</title></rect>` : ''; }).join('');
  const line = temp.map((v, i) => v == null ? '' : `${i ? 'L' : 'M'}${(pad + i * bw + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const labels = idx.map((ix, i) => i % 6 === 0 ? `<text x="${pad + i * bw}" y="${H - 10}" font-size="11" fill="#5f7186">${(() => { const hh = +h.time[ix].slice(11, 13); return X.state.lang === 'zh' ? `${hh}时` : hh === 0 ? '12a' : hh < 12 ? `${hh}a` : hh === 12 ? '12p' : `${hh - 12}p`; })()}</text>` : '').join('');
  const days = idx.map((ix, i) => h.time[ix].slice(11, 13) === '00' ? `<line x1="${pad + i * bw}" x2="${pad + i * bw}" y1="10" y2="${H - 26}" stroke="#E3EAF0"/><text x="${pad + i * bw + 3}" y="12" font-size="10.5" fill="#5f7186">${esc(dayName(h.time[ix].slice(0, 10)))}</text>` : '').join('');
  const tot = snow.reduce((a, b) => a + b, 0);
  return `<svg viewBox="0 0 ${W} ${H}" class="bchart" role="img" aria-label="${esc(tr('b_48'))}">${days}${bars}<path d="${line}" fill="none" stroke="#F28C38" stroke-width="2.5"/>
    <text x="${W - pad}" y="${y(tmax) - 4}" font-size="11" text-anchor="end" fill="#b35f14">${Math.round(tmax)}°</text><text x="${W - pad}" y="${y(tmin) + 13}" font-size="11" text-anchor="end" fill="#b35f14">${Math.round(tmin)}°</text>${labels}</svg>
    <p class="small muted">❄️ ${esc(tr('b_snow_bars'))}: ${fmt.snow(tot * (im ? 2.54 : 1), U())} · <span style="color:#b35f14">━</span> ${esc(tr('b_temp_line'))} (${im ? '°F' : '°C'})</p>`;
}
function table7(pt) {
  const d = pt.daily, u = U();
  return `<div class="dtable"><table class="b7"><thead><tr><th>${esc(tr('b_day'))}</th><th></th><th>${esc(tr('b_snow'))}</th><th>${esc(tr('b_hilo'))}</th><th>${esc(tr('b_wind'))}</th></tr></thead><tbody>
    ${d.time.map((t, i) => `<tr><td>${esc(dayName(t))}</td><td>${weatherEmoji(d.weather_code[i])}</td><td><b>${fmt.snow(d.snowfall_sum[i], u)}</b></td><td>${fmt.temp(d.temperature_2m_max[i], u)} / ${fmt.temp(d.temperature_2m_min[i], u)}</td><td>${fmt.wind(d.wind_speed_10m_max[i], u)} <small class="muted">(${fmt.wind(d.wind_gusts_10m_max[i], u)})</small></td></tr>`).join('')}
  </tbody></table></div>`;
}
/** Today's weather checks from the basic forecast (summit point): same thresholds as the full dashboards (data/resorts.json rules). */
function basicWeather(fc) {
  const T = X.t, u = U(), rules = X.state.cfg.rules, pt = fc?.summit; if (!pt?.daily) return null;
  const d = pt.daily, h = pt.hourly, day = d.time[0], src = T('src_om'), out = [];
  const sn = d.snowfall_sum?.[0];
  if (sn != null) out.push(sn >= rules.snowCautionCm ? { level: 'caution', text: tr('b_heavy', fmt.snow(sn, u)), src } : { level: 'go', text: T('r_snow_ok', fmt.snow(sn, u)), src });
  const g = d.wind_gusts_10m_max?.[0];
  if (g != null) out.push(g >= rules.gustCautionKmh ? { level: 'caution', text: T('r_wind', fmt.wind(g, u)), src } : { level: 'go', text: T('r_wind_ok', fmt.wind(g, u)), src });
  const feels = (h?.time || []).map((t, k) => t.startsWith(day) ? h.apparent_temperature?.[k] : null).filter(v => v != null);
  const vis = (h?.time || []).map((t, k) => t.startsWith(day) && +t.slice(11, 13) >= 9 && +t.slice(11, 13) <= 16 ? h.visibility?.[k] : null).filter(v => v != null);
  if (vis.length) { const m = Math.min(...vis), vl = visLevel(m); out.push({ level: vl, text: T(vl === 'caution' ? 'r_vis_low' : vl === 'info' ? 'r_vis_some' : 'r_vis_ok', fmt.vis(m, u)), src }); }
  if (feels.length && Math.min(...feels) <= rules.feelsLikeCautionC) out.push({ level: 'caution', text: T('r_cold', fmt.temp(Math.min(...feels), u)), src });
  return out;
}
export function renderBasic() {
  const B = D.basic, r = D.byId.get(B.id), el = $('#basic'); if (!r || !el) return;
  const T = X.t, UI = X.ui, c = cond(r), u = U(), f = favs().includes(r.id), s = startPt(), p = report(r), co = r.state === 'CO';
  ensureBasicRoute(r);
  const pt = B.fc ? B.fc[B.point] : null, rt = B.route;
  // Checks: Mountain (resort report) / Road (CDOT along the OSRM route, Colorado only) / Weather (Open-Meteo)
  const repSrc = p?.source?.name || tr('d_rep');
  const mtn = [];
  if (p?.status === 'closed') mtn.push({ level: 'nogo', text: T('r_resort_closed', ''), src: repSrc });
  else if (p?.status && p.lifts?.total && p.lifts.open / p.lifts.total < 0.25) mtn.push({ level: 'caution', text: pctTxt(p) != null ? T('r_limited_t', `${p.lifts.open}/${p.lifts.total}`, pctTxt(p)) : T('r_limited', `${p.lifts.open}/${p.lifts.total}`), src: repSrc });
  else if (p?.status && p.lifts?.total) mtn.push({ level: 'go', text: T('r_lifts_ok', `${p.lifts.open}/${p.lifts.total}`), src: repSrc });
  else if (p) mtn.push({ level: 'unknown', text: tr('b_nostatus'), src: repSrc });
  if (p) mtn.push({ level: 'info', text: seasonTxt(r), src: repSrc });
  const rc = co && rt ? X.roadCheck(r, rt) : null;
  const road = !co ? [{ level: 'unknown', text: tr('b_noroads') }]
    : rc ? rc.reasons.map(x => ({ level: x.level, text: x.text, src: T('src_cdot'), det: [x.segLabel ? `<b>${esc(x.segLabel)}</b>` : '', x.ev?.detail ? esc(x.ev.detail) : ''].filter(Boolean).join('<br>') }))
    : [{ level: 'unknown', text: B.routeErr ? tr('b_route_fail') : !X.state.roads?.data && rt ? T('g_roads_na') : tr('b_wait_route') }];
  const wx = basicWeather(B.fc);
  const weather = wx || [{ level: 'unknown', text: B.fcErr ? tr('b_fc_fail') : tr('b_wx_wait') }];
  const all = [...mtn, ...road, ...weather];
  const level = all.some(x => x.level === 'nogo') ? 'nogo' : all.some(x => x.level === 'caution') ? 'caution' : 'go';
  const rec = recommendFrom(p ? { ok: true, status: p.status, lifts: p.lifts, terrain: { pct: p.pct }, snow: { h24: rep24(p) } } : null, level);
  const when = updTime([p?.at, p?.snowAt].filter(Boolean).sort().pop() || p?.fetchedAt);
  const basis = rec.key === 'rec_noreport' ? T('rec_noreport_sub') : T('rec_basis', `${T('rec_src_rep', `${repSrc}, ${when}`)}, ${tr(co ? 'b_rest_co' : 'b_rest')}`);
  const why = all.filter(x => x.level === 'nogo' || x.level === 'caution').sort((a, b) => (a.level === 'nogo' ? 0 : 1) - (b.level === 'nogo' ? 0 : 1)).map(x => x.text);
  // Mountain conditions tiles ("Not reported" for what the resort doesn't publish)
  const NR = tr('d_nr'), frac = o => o?.total ? `${o.open}<small>/${o.total}</small>` : null, s24 = snow24(r);
  const tiles = `<div class="tiles t6">
      ${UI.tile('❄️', s24 != null ? fmt.snow(s24, u) : null, tr(rep24(p) != null ? 'b_new_rep' : 'b_new_mod'), '', NR)}
      ${UI.tile('🌡️', c?.summit?.t != null ? fmt.temp(c.summit.t, u) : null, tr('b_temp_now'), '', '—')}
      ${UI.tile('🚡', frac(p?.lifts), tr('b_lifts'), '', NR)}
      ${UI.tile('⛷️', frac(p?.trails), tr('b_runs'), '', NR)}
      ${UI.tile('🗺️', pctTxt(p) != null ? esc(pctTxt(p)) : null, tr('b_terrain'), p?.basis === 'acres' && p.acres ? esc(tr('d_acres', nf0(p.acres.open), nf0(p.acres.total))) : '', NR)}
      ${UI.tile('📏', baseCm(r) != null ? baseTxt(baseCm(r), u) : null, tr('b_base'), '', NR)}
    </div>`;
  const elev = fmt.elev(c?.elev?.summit ?? r.summitElevM, u);
  const msrc = p ? tr('b_src_rep', repSrc, when, elev) : tr('b_src_none', elev);
  // Getting there
  const roadsOk = !!X.state.roads?.data && !!rc;
  const cnt = kinds => rc ? X.roadCount(rc.reasons, kinds, roadsOk) : { cls: 'unknown', txt: '—' };
  const gdir = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
  const glist = `<ul class="glist">
      ${UI.grow(T('g_dist'), rt ? esc(kmTxt(rt.distM / 1000)) : `${esc(kmTxt(distKm(r)))}`, '', rt ? '' : esc(tr('d_straight')))}
      ${UI.grow(T('g_time'), rt ? `~${esc(durTxt(Math.round(rt.durS / 60)))}` : `<span class="muted">${esc(B.routeErr ? tr('b_route_fail') : tr('b_route_loading'))}</span>`, '', rt ? esc(T('g_time_note')) : '')}
      ${UI.grow(T('g_traffic'), `<span class="muted">${esc(T('g_traffic_na'))}</span>`, '', co ? `<a href="https://www.cotrip.org/trip-planner" target="_blank" rel="noopener">${esc(T('g_traffic_link'))} ↗</a>` : `<a href="${gdir}" target="_blank" rel="noopener">${esc(tr('b_traffic_link'))} ↗</a>`)}
      ${co ? ['chain', 'closure', 'incident'].map((k, n) => { const v = cnt(n === 2 ? ['incident', 'conditions'] : [k]); return UI.grow(T('g_' + k), esc(v.txt), v.cls); }).join('')
        : UI.grow(tr('b_roads_out'), esc(tr('b_roads_out_v')), 'unknown')}
    </ul><p class="hp-src">${esc(tr('b_drive_src', X.L(s.name) || ''))}${co ? ` · ${esc(T('g_src', X.state.roads?.at ? updTime(X.state.roads.at) : T('unavailable')))}` : ''}</p>`;
  const stEl = document.getElementById('start'); if (stEl && el.contains(stEl)) stEl.remove();
  el.innerHTML = `
  <div class="hero-wrap b2" style="${r.photo?.src ? `--hero-img:url('${esc(new URL(r.photo.src, location.href).href)}')` : ''}"><div class="wrap hero-in">
    <button type="button" class="dback" data-home>← ${esc(tr('d_back'))}</button>
    <div class="bhead"><h1 class="q" id="b-q">${esc(T('q_dyn', r.name))}</h1><button type="button" class="dfav big${f ? ' on' : ''}" data-fav="${r.id}" aria-pressed="${f}" title="${esc(tr(f ? 'd_remfav' : 'd_addfav'))}">${f ? '★' : '☆'}</button></div>
    <p class="bmeta2">${esc(r.city)}, ${esc(stateTxt(r))} · ${esc(regionName(r.region))} · <b>${esc(passTxt(r))}</b> · ${esc(r.range)} · ${fmt.elevRange(r.baseElevM, r.summitElevM, u)}</p>
    <div id="b-verdict">${UI.rec(rec, why, basis)}</div>
    <div class="hgrid">
      <div class="vpanel hp" id="b-mtn"><h2 class="hp-h">🏔️ ${esc(T('mtn_h'))}</h2>${tiles}<p class="hp-src">${esc(msrc)}${p?.source?.url ? ` <a href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(tr('d_rep_src', new URL(p.source.url).host.replace(/^www\./, '')))} ↗</a>` : ''}</p></div>
      <details class="vpanel hp getthere" id="b-get"><summary><h2 class="hp-h">🚗 ${esc(T('get_h'))}</h2></summary><div id="b-start-slot"></div>${glist}</details>
    </div>
    <div class="why" id="b-why">${UI.know([
      { g: 'mountain', items: mtn, empty: tr('b_norep') },
      { g: 'road', items: road },
      { g: 'weather', items: weather, note: [tr('b_nws'), basicWeatherNote()].filter(Boolean).join(' ') }])}</div>
    ${r.photo ? `<p class="hero-credit">📷 ${esc(r.photo.credit)} · <a href="${esc(r.photo.page)}" target="_blank" rel="noopener">${esc(r.photo.license)}</a></p>` : ''}
  </div></div>
  <main class="wrap">
    <section class="block card"><div class="sec-h"><h2>${esc(tr('b_48'))}</h2>
      <div class="seg-ctl" data-ctl="bpoint">${['summit', 'mid'].map(p => `<button type="button" data-bp="${p}" class="${B.point === p ? 'on' : ''}">${esc(tr(p === 'mid' ? 'b_mid' : 'b_summit'))}</button>`).join('')}</div></div>
      ${pt ? `<div data-fc="hourly">${chart48(pt)}</div>` : `<p class="muted">${esc(B.fcErr ? tr('b_fc_fail') : tr('b_loading'))}</p>`}
      ${B.fc ? `<p class="small muted">${esc(tr('b_fc_src', tr(B.point === 'mid' ? 'b_mid' : 'b_summit'), fmt.elev(B.fc.points[B.point], u)))} ${esc(tr('d_upd', updTime(B.fc.fetchedAt)))}</p>` : ''}
    </section>
    <section class="block card"><h2>${esc(tr('b_7d'))}</h2>${pt ? `<div data-fc="daily">${table7(pt)}</div>` : `<p class="muted">${esc(B.fcErr ? tr('b_fc_fail') : tr('b_loading'))}</p>`}</section>
    <section class="block card"><h2>${esc(tr('b_map'))}</h2>
      <div id="b-map" class="rmap"></div>
      <p class="small"><a href="${gdir}" target="_blank" rel="noopener">${esc(tr('b_dir'))} ↗</a></p>
    </section>
    <section class="block card"><h2>${esc(tr('b_links'))}</h2>
      <ul class="blinks"><li><a href="${esc(r.url)}" target="_blank" rel="noopener">🌐 ${esc(tr('b_site'))} ↗</a></li><li><a href="${esc(r.url)}" target="_blank" rel="noopener">🎿 ${esc(tr('b_report'))} ↗</a></li></ul>
      <p class="small muted">${esc(tr('b_elev'))}: ${fmt.elevRange(r.baseElevM, r.summitElevM, u)} · ${esc(tr('b_src'))}: <a href="${esc(r.src)}" target="_blank" rel="noopener">Wikipedia</a> · ${esc(tr('b_pass'))}: ${esc(passTxt(r))} (ikonpass.com / epicpass.com, 2026/27)</p>
    </section>
    <section class="block card altsec" id="b-alts"></section>
  </main>`;
  if (stEl) { el.querySelector('#b-start-slot')?.replaceWith(stEl); try { X.state.startUI?.relabel(); X.state.startUI?.setMsg(''); } catch {} }
  document.title = `SkiDay · ${T('q_dyn', r.name)}`;
  drawBasicMap(r);
  renderAlts(r.id, document.getElementById('b-alts'));
}
const basicWeatherNote = () => (D.basic.fc?.summit?.hourly?.visibility ? X.t('vis_note') : X.t('no_vis'));
/** Drive estimate for the current start (re-fetched when the start changes; cached by start.js). */
function ensureBasicRoute(r) {
  const B = D.basic, s = startPt(), sk = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
  if (B.routeFor === sk) return;
  B.routeFor = sk; B.route = null; B.routeErr = null;
  const id = r.id;
  getRoute(X.state.cfg, s, r).then(rt => { if (B.id === id && B.routeFor === sk) B.route = rt; })
    .catch(() => { if (B.id === id && B.routeFor === sk) B.routeErr = true; })
    .finally(() => { if (B.id === id && B.routeFor === sk && X.view() === 'basic') renderBasic(); });
}
function drawBasicMap(r) {
  const el = document.getElementById('b-map'); if (!el) return;
  X.loadLeaflet().then(Lf => {
    if (!document.body.contains(el)) return;
    if (D.basic.map) { try { D.basic.map.remove(); } catch {} }
    const m = Lf.map(el, { scrollWheelZoom: false, tap: false }); D.basic.map = m;
    Lf.tileLayer(X.state.cfg.sources.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: (X.state.cfg.sources.tilesAttribution || '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors') + ' · <a href="https://www.openstreetmap.org/fixthemap">Report a map error</a>' }).addTo(m);
    const s = startPt();
    const end = Lf.circleMarker([r.lat, r.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#F28C38', fillOpacity: 1 }).addTo(m).bindTooltip(r.name);
    const st = Lf.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#25845A', fillOpacity: 1 }).addTo(m).bindTooltip(X.L(s.name) || '');
    if (D.basic.route) { const line = Lf.polyline(D.basic.route.pts.map(p => [p[1], p[0]]), { color: '#14283F', weight: 4, opacity: .85 }).addTo(m); m.fitBounds(line.getBounds(), { padding: [16, 16] }); }
    else m.fitBounds(Lf.latLngBounds([[r.lat, r.lon], [s.lat, s.lon]]), { padding: [30, 30], maxZoom: 10 });
    void end; void st;
  }).catch(() => { el.innerHTML = '<p class="muted small" style="padding:16px">Map unavailable</p>'; });
}
export async function showBasic(id) {
  const B = D.basic;
  if (B.id !== id) Object.assign(B, { id, fc: null, fcErr: null, route: null, routeErr: null, routeFor: null });
  renderBasic();
  if (!document.getElementById('basic').dataset.bound) {
    document.getElementById('basic').dataset.bound = '1';
    document.getElementById('basic').addEventListener('click', e => {
      const bp = e.target.closest('[data-bp]'); if (bp) { D.basic.point = bp.dataset.bp; X.forecast?.('summit_base', bp.dataset.bp); renderBasic(); return; }
      const fav = e.target.closest('[data-fav]'); if (fav) { toggleFav(fav.dataset.fav); renderBasic(); return; }
      if (e.target.closest('[data-home]')) { e.preventDefault(); X.home(); }
    });
  }
  const r = D.byId.get(id);
  const jobs = [];
  if (!D.cond) jobs.push(loadConditions(true).finally(() => { if (D.basic.id === id && X.view() === 'basic') renderBasic(); }));
  if (r.state === 'CO' && !X.state.roads?.data && X.loadRoads) jobs.push(X.loadRoads().finally(() => { if (D.basic.id === id && X.view() === 'basic') renderBasic(); }));
  if (!B.fc) jobs.push(X.getJson(`api/forecast.json?r=${encodeURIComponent(id)}`, 20000).then(j => { if (D.basic.id === id) B.fc = j; }).catch(() => { if (D.basic.id === id) B.fcErr = true; }).finally(() => { if (D.basic.id === id && X.view() === 'basic') renderBasic(); }));
  await Promise.allSettled(jobs);
}


/* ================= Alternatives: "Not looking great here? Compare nearby mountains." ================= */
// Pure ranking over data SkiDay already has (catalog report + Open-Meteo summary + CDOT events). Rules:
//  - never suggest a resort that reports itself closed, or one with no readable status (can't confirm it's open);
//  - skip resorts with a full CDOT closure or passenger chain law within ~20 km (Colorado only), or summit gusts >= 80 km/h;
//  - keep only options that are better (open vs closed, more terrain/lifts/new snow, or closer with similar conditions) or comparable
//    (ski-day score within 3 points), never clearly worse on terrain;
//  - rank by ski-day score (already includes distance from the start) + 6 for the same pass − 5 for a traction law nearby.
const ALT_NEAR_KM = 250, GUST_HOLD = 80;
function roadNear(r) {
  if (r.state !== 'CO') return { na: true };
  const ev = X.state.roads?.data; if (!ev) return { unknown: true };
  const near = ev.filter(e => (e.geo || []).some(([lon, lat]) => hav({ lat, lon }, r) <= 20));
  const closure = near.filter(e => e.cls === 'roadClosures' && /closed|closure/i.test(e.title) && !/lane|shoulder|ramp|seasonal/i.test(e.title) && !(e.start && e.start > Date.now() + 2 * 3600e3));
  const chains = near.filter(e => e.cls === 'chainLaws').map(chainLevel);
  return { closure: closure.length, chainNogo: chains.filter(l => l === 'nogo').length, chain: chains.filter(l => l === 'caution').length };
}
const minTxt = m => m < 60 ? (X.state.lang === 'zh' ? `${m} 分钟` : `${m} min`) : durTxt(m);
const lineMin = km => Math.round(km * 1.3 / 80 * 60);     // straight line × 1.3 road factor at ~80 km/h average
function passInfo(cur, r) {
  const same = r.passes.filter(p => cur.passes.includes(p)).map(p => p[0].toUpperCase() + p.slice(1));
  if (same.length) return { cls: 'go', txt: tr('a_pass_same', same.join(' · ')), same: true };
  if (!r.passes.length) return { cls: 'na', txt: tr('a_pass_ticket') };
  return { cls: 'caution', txt: tr('a_pass_diff', passTxt(r)) };
}
export function altCandidates(curId, drive = null) {
  const cur = D.byId.get(curId); if (!cur || !D.cond) return null;
  const sc0 = score(cur)?.total ?? 0, km0 = distKm(cur), o0 = opStatus(cur), p0 = report(cur);
  const maxKm = km0 + 150;
  const pool = D.cat.resorts.filter(r => r.id !== curId && hav(r, cur) <= ALT_NEAR_KM && distKm(r) <= maxKm);
  const x = { closed: 0, nr: 0, worse: 0, road: 0, wind: 0 }, out = [];
  for (const r of pool) {
    const p = report(r), o = opStatus(r), c = cond(r), sc = score(r);
    if (o.cls === 'nogo') { x.closed++; continue; }
    if (o.cls === 'na' || !sc) { x.nr++; continue; }
    const rd = roadNear(r);
    if (rd.closure || rd.chainNogo) { x.road++; continue; }
    if ((c?.summit?.gust ?? 0) >= GUST_HOLD) { x.wind++; continue; }
    const adv = [], u = U();
    const pc = pctOpen(r), pc0 = pctOpen(cur), s = snow24(r), s0 = snow24(cur);
    const lif = p?.lifts, lif0 = p0?.lifts;
    if (o0.cls === 'nogo') adv.push(['open', tr('a_r_open', lif?.total ? `${lif.open}/${lif.total}` : '?', cur.name)]);
    else if (o0.cls === 'caution' && o.cls === 'go' && lif && lif0) adv.push(['notlim', tr('a_r_notlim', `${lif.open}/${lif.total}`, `${lif0.open}/${lif0.total}`)]);
    if (pc != null && pc0 != null && pc - pc0 >= 10) adv.push(['terrain', tr('a_r_terrain', pctTxt(p), pctTxt(p0))]);
    if (s != null && s0 != null && s - s0 >= 5) adv.push(['snow', tr('a_r_snow', fmt.snow(s, u), fmt.snow(s0, u))]);
    if (lif && lif0 && o0.cls !== 'nogo' && lif.open - lif0.open >= 3 && !adv.some(a => a[0] === 'notlim')) adv.push(['lifts', tr('a_r_lifts', lif.open, lif0.open)]);
    // "Closer" only from the road-network estimate (both legs from the same OSRM table); otherwise as the crow flies, said so.
    const dv = drive?.[r.id], dv0 = drive?.[curId];
    if (dv && dv0) { const m = Math.round((dv0.durS - dv.durS) / 60); if (m >= 15 && sc.total >= sc0 - 3) adv.push(['closer', tr('a_r_closer', minTxt(m))]); }
    else { const dk = km0 - distKm(r); if (dk >= 40 && sc.total >= sc0 - 3) adv.push(['closer', tr('a_r_closer_line', kmTxt(dk))]); }
    const comparable = Math.abs(sc.total - sc0) <= 3 || sc.total > sc0;
    const worseTerrain = o0.cls !== 'nogo' && pc != null && pc0 != null && pc0 - pc > 10;
    const keep = !worseTerrain && ((adv.length && sc.total >= sc0 - 5) || comparable || o0.cls === 'nogo');
    if (!keep) { x.worse++; continue; }
    const pi = passInfo(cur, r);
    out.push({ r, sc: sc.total, adv, pi, rd, rank: sc.total + (pi.same ? 6 : 0) - (rd.chain ? 5 : 0) });
  }
  out.sort((a, b) => b.rank - a.rank);
  return { cur, list: out.slice(0, 5), checked: pool.length, x };
}
function altCard(a, cur, drive) {
  const r = a.r, p = report(r), u = U(), s = snow24(r);
  const dv = drive?.[r.id];
  const dTxt = dv ? durTxt(Math.round(dv.durS / 60)) : durTxt(lineMin(distKm(r)));
  const reason = a.adv[0]?.[1] || tr('a_r_comp');
  return `<li class="alt" data-id="${r.id}">
    <div class="alt-h"><a href="?resort=${encodeURIComponent(r.id)}" data-alt="${r.id}"><b>${esc(r.name)}</b></a><span class="alt-sc" title="${esc(tr('d_score'))}">${a.sc}</span></div>
    <p class="alt-m">${esc(regionName(r.region))} · ${esc(stateTxt(r))}</p>
    <div class="alt-chips">${statusHtml(r)}<span class="dst s-${a.pi.cls}"><i aria-hidden="true"></i>${esc(a.pi.txt)}</span>${a.rd.chain ? `<span class="dst s-caution"><i aria-hidden="true"></i>${esc(tr('a_road_chain'))}</span>` : ''}</div>
    <div class="alt-st">
      <span><b>${esc(tr('a_drive_est', dTxt))}</b><small>${esc(tr(dv ? 'a_drive_osrm' : 'a_drive_line'))}</small></span>
      <span>${pctTxt(p) != null ? `<b>${esc(pctTxt(p))}</b>` : nr()}<small>${esc(tr('a_terrain'))}</small></span>
      <span>${s != null ? `<b>${fmt.snow(s, u)}</b>` : nr()}<small>${esc(tr(rep24(p) != null ? 'c_new_rep' : 'c_new_mod'))}</small></span>
    </div>
    <p class="alt-why">${esc(reason)}</p>
    <a class="dgo alt-go" href="?resort=${encodeURIComponent(r.id)}" data-alt="${r.id}">${esc(tr('a_view'))} →</a>
  </li>`;
}
/** Render the alternatives block into `el` (dashboard #alts or the basic page's section). */
export function renderAlts(curId, el) {
  if (!el) return;
  if (!el.dataset.altBound) {
    el.dataset.altBound = '1';
    el.addEventListener('click', e => { const a = e.target.closest('[data-alt]'); if (!a || e.metaKey || e.ctrlKey) return; e.preventDefault(); X.track('alt_open', a.dataset.alt); X.open(a.dataset.alt, 'alternative'); });
  }
  const head = `<h2>${esc(tr('a_h'))}</h2>`;
  if (!D.cat || !D.cond) { el.innerHTML = `${head}<p class="muted">${esc(tr('a_loading'))}</p>`; return; }
  let res = altCandidates(curId); if (!res) { el.innerHTML = ''; return; }
  const s = startPt(), key = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}>${curId}>${res.list.map(a => a.r.id).join(',')}`;
  const st = D.altDrive?.key === key ? D.altDrive : null, drive = st?.v || null;
  if (drive) res = altCandidates(curId, drive);
  const why = Object.entries(res.x).filter(([, n]) => n).map(([k, n]) => tr('a_x_' + k, n)).join(' · ');
  el.innerHTML = `${head}<p class="muted small">${esc(tr('a_lead', res.cur.name, X.L(s.name) || ''))}</p>
    ${res.list.length ? `<ul class="alts">${res.list.map(a => altCard(a, res.cur, drive)).join('')}</ul>`
      : `<div class="alt-none"><p><b>${esc(tr('a_none', res.cur.name))}</b></p>${res.checked ? `<p class="small muted">${esc(tr('a_none_why', res.checked, why))}</p>` : ''}</div>`}
    ${res.list.length && why ? `<p class="small muted">${esc(tr('a_none_why', res.checked, why))}</p>` : ''}
    <p class="small muted">${esc(tr('a_note'))}</p>`;
  if (res.list.length && !st) {
    D.altDrive = { key, v: null };   // one table request per start + list; a failure keeps the straight-line estimate
    getTable(X.state.cfg, s, [res.cur, ...res.list.map(a => a.r)]).then(v => { if (D.altDrive?.key !== key) return; D.altDrive = { key, v }; if (document.body.contains(el)) renderAlts(curId, el); }).catch(() => {});
  }
}

/* ================= Plan a Ski Trip (placeholder for the coming trip planner) ================= */
export function renderPlan() {
  const el = document.getElementById('plan'); if (!el) return;
  el.innerHTML = `<div class="disc-hero plan-hero"><div class="wrap"><span class="psoon">${esc(tr('p_soon'))}</span><h1 class="q">${esc(tr('p_title'))}</h1><p class="dsub">${esc(tr('p_lead'))}</p></div></div>
    <div class="wrap"><div class="card pcard"><h2>${esc(tr('p_now'))}</h2><ul class="plist">
      <li><a href="./" data-home data-ptab="best">❄️ ${esc(tr('p_now1'))}</a></li>
      <li><a href="./" data-home data-ptab="explore">🗺️ ${esc(tr('p_now2'))}</a></li>
      <li><a href="./" data-home data-ptab="best">⚖️ ${esc(tr('p_now3'))}</a></li>
      <li><a href="./" data-home data-ptab="near">🚗 ${esc(tr('p_now4'))}</a></li></ul>
      <p class="small muted">${esc(tr('p_note'))}</p><p><a class="dgo" href="./" data-home data-ptab="best">${esc(tr('p_back'))}</a></p></div></div>`;
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', e => { const a = e.target.closest('[data-home]'); if (!a) return; e.preventDefault(); D.tab = a.dataset.ptab || 'best'; D.q = ''; X.home(); });
  }
}
