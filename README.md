# SingHouse · 新加坡房价分布

新加坡 HDB 组屋转售价格的动态展示网站：按 26 个市镇在“地块地图”上着色，拖动或播放时间轴即可看到 2015 年至今的价格变化。

## 功能

- **市镇地块地图**：26 个 HDB 市镇按大致地理位置排列，颜色表示中位价或同比涨幅；色阶在各年份间固定，播放时能直接看出整体上涨。
- **时间轴动画**：▶ 逐年播放，地图、排名、KPI 同步过渡。
- **排名与分布**：每个市镇的 25%–75% 分位区间加中位数，年份变化时排序会动画重排；切到“同比涨幅”时显示涨跌条。
- **五大区域**：中部、北部、东北部、东部、西部的中位价和同比变化。
- **历年走势**：全国均线加上最多 3 个选中市镇（点击地图或排名可以增减），悬停查看各年数值。
- **户型筛选**：全部、三房、四房、五房、公寓式。
- 支持深色/浅色模式、手机布局，并提供完整数据表。

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

`data/hdb-data.js` 由 `scripts/build_data.py` 生成。

**仓库自带的是估算示例数据**：它按 HDB 转售价格指数（RPI）的走势和各市镇的大致价位生成，只用于演示，页面顶部会标注这一点。如果要换成官方成交数据：

1. 在 [data.gov.sg](https://data.gov.sg/collections/189/view) 下载 *Resale flat prices based on registration date* 的 CSV（可以下载多个时段）。
2. 运行：

   ```bash
   python3 scripts/build_data.py --csv resale-2017-onwards.csv --csv resale-2015-2016.csv
   ```

脚本会按 市镇 × 户型 × 年份 汇总 25%/50%/75% 分位数和成交套数，成交少于 5 笔的格子记为空。页面会自动去掉“示例数据”提示。

## 结构

```
index.html           页面骨架
assets/styles.css    样式（含深色模式）
assets/app.js        地图、排名、走势图、交互（原生 JS + SVG）
data/hdb-data.js     汇总后的数据
scripts/build_data.py  数据生成/汇总脚本
```
