# SingHouse · 新加坡房价分布

动态展示新加坡房价分布的网站，有两种市场可以切换：

- **HDB 组屋**：26 个市镇的转售中位价（总价）
- **私宅（非有地）**：28 个邮区的成交中位呎价（新元/平方英尺），按 CCR / RCR / OCR 三大市场区域汇总

在“地块地图”上按价格着色，拖动或播放时间轴即可看到 2015 年至今的变化。

## 功能

- **地块地图**：市镇或邮区按大致地理位置排列，颜色表示价格或同比涨幅；色阶在各年份间固定，播放时能直接看出整体上涨。
- **时间轴动画**：▶ 逐年播放，地图、排名、KPI 同步过渡。
- **排名与分布**：25%–75% 分位区间加中位数，年份变化时排序会动画重排；切到“同比涨幅”时显示涨跌条。
- **区域汇总**：HDB 五大区域；私宅 CCR / RCR / OCR。
- **历年走势**：全国线加上最多 3 个选中区域（点击地图或排名可以增减），悬停查看各年数值。
- **类型筛选**：HDB 按户型（三房、四房、五房、公寓式）；私宅按类型（Condo、Apartment、EC）。
- 支持深色/浅色模式、手机布局和完整数据表；链接带 `#private` 时直接打开私宅视图。

## 运行

纯静态页面，没有任何依赖：

```bash
# 直接双击打开 index.html，或
python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

### 部署到 GitHub Pages

仓库带有 `.github/workflows/pages.yml`，每次推送到 `main` 都会自动发布（也可以在 Actions 页手动运行）。

首次使用前需要开启一次：仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
发布后的地址是 `https://<用户名>.github.io/<仓库名>/`。

## 数据

数据文件由 `scripts/build_data.py` 生成：`data/hdb-data.js`（HDB）、`data/private-data.js`（私宅）。

**仓库自带的是估算示例数据**：它按官方价格指数（HDB 转售价格指数、URA 私宅价格指数）的走势和各区域的大致价位生成，只用于演示，页面顶部会标注这一点。换成官方成交数据的方法：

**HDB**：在 [data.gov.sg](https://data.gov.sg/collections/189/view) 下载 *Resale flat prices based on registration date* 的 CSV，然后运行

```bash
python3 scripts/build_data.py hdb --csv resale-2017-onwards.csv --csv resale-2015-2016.csv
```

**私宅**：任选一种来源

```bash
# URA Data Service API（PMI_Resi_Transaction，batch 1–4 的 JSON 响应，需要先申请 AccessKey）
python3 scripts/build_data.py private --ura-json batch1.json --ura-json batch2.json --ura-json batch3.json --ura-json batch4.json

# 或 URA 网站导出的私宅成交 CSV（需要 Sale Date、Postal District、Property Type、Unit Price ($ PSF) 等列）
python3 scripts/build_data.py private --csv ura-transactions.csv
```

私宅只统计 Condominium、Apartment、Executive Condominium，不含有地住宅（地契面积的呎价没有可比性）。

脚本会按 区域 × 类型 × 年份 汇总 25%/50%/75% 分位数和成交量，成交少于 5 笔的格子记为空。重新生成后，页面上的“示例数据”提示会自动消失。

## 结构

```
index.html           页面骨架
assets/styles.css    样式（含深色模式）
assets/app.js        地图、排名、走势图、交互（原生 JS + SVG）
data/*.js            汇总后的数据（HDB、私宅）
scripts/build_data.py  数据生成/汇总脚本
```
