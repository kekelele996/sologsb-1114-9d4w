# 洞穴测绘草图编目台（gbcavesurvey）

面向洞穴测绘小组测量记录员的本地化编目台：把「洞段 → 测点方位/倾角/距离读数 → 草图 → 图幅拼合」串成一条可回溯的链路，解决手写记录散落、闭合导线误差看不出来、多张草图拼接对不上桩号的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21814>

常用命令：

```bash
docker compose ps          # 查看容器状态
docker compose logs -f     # 查看日志
docker compose down        # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbcavesurvey
FRONTEND_PORT=21814
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（`vue-tsc` 类型检查零错误） |
| UI 组件库 | Element Plus |
| 状态管理 | Zustand（`zustand/vanilla` createStore + Vue 响应式桥接） |
| 路由 | Vue Router 4（History 模式，nginx `try_files` 回落） |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21814
npm run build      # 类型检查 + 生产构建
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1114/
├── docker-compose.yml          # 顶层 name: gbcavesurvey，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # cave.ts / instrument.ts / segment.ts / station.ts / sketch.ts / index.ts
│       ├── stores/             # instrumentStore / caveStore / segmentStore / stationStore / sketchStore（Zustand）
│       ├── components/common/  # SegmentTag / BearingInput / ClosureBadge / GridCanvas
│       ├── hooks/              # usePersistentStore / useClosureCheck
│       ├── pages/              # CavesPage / SegmentsPage / StationsPage / SketchPage / MergePage
│       ├── router/index.ts
│       └── utils/              # survey.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Cave 洞穴 | 归属根节点：洞名、行政区、经纬度、海拔、发育层位、已知总长、负责人等 | `caves` |
| Instrument 仪器 | 仪器室标定档案：仪器号、标定日期、有效期至、结论（合格/限用/不合格）、是否停用 | `instruments` |
| Segment 洞段 | 起止桩号、类型（竖井/廊道/厅堂/裂隙/水道）、平均宽高、是否闭合 | `segments` |
| Station 测点读数 | 方位角、倾角、斜距与仪器号；同一桩号可保留原读数和补测读数，测量组标记采用/留档/待确认 | `stations` |
| Sketch 草图 | 格数、比例、绘制人、拼合顺序号、桩号对齐锚点；图幅锚点按有效读数累计位置重算 | `sketches` |

- 数据库名 `gbcavesurvey`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会把旧版测点记录由「斜距 + 倾角」补齐 `horizontalDistance` / `verticalDistance`；
- `version(3)` 新增 `instruments` 表，并给测点补充 `readingStatus` / `isResurvey`；旧数据没有仪器档案可对账，读数先归为“待确认”，不会自动进入正式成果；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷，清除浏览器数据即清空。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/caves` | 洞穴清单：卡片展示实测/已知总长、洞段数、最近测量日期，支持新建、编辑、归档、删除（删除前校验下级洞段数） |
| `/instruments` | 仪器标定档案：仪器室维护标定日期、有效期、结论、停用状态；按仪器号与现场读数对账，失败后由测量组逐台重试，不移动原成果 |
| `/segments` | 洞段编目表：按桩号区间/类型/洞穴筛选，批量调整洞段类型与闭合标记，自动累计总长，并显示有效/现场读数数量 |
| `/stations` | 测点读数录入：方位角/倾角专用输入（度分秒 ⇄ 十进制度），自动推算水平距垂距；测量组选择采用/留档/待确认，支持同桩号补测与逐读数排除原因说明 |
| `/sketch` | 草图工作台：只按有效读数重算测点折线、标注桩号与倾角箭头，支持草图基准方位旋转与草图记录管理；被排除读数保留在测点页并显示仪器原因 |
| `/merge` | 图幅拼合视图：拖动图幅按相邻边缘吸附，按有效读数累计的实测导线位置重算桩号锚点，输出拼合顺序表并支持 CSV 导出 |

## 七、计算约定

- 水平距 = 斜距 × cos(倾角)，垂距 = 斜距 × sin(倾角)；
- 仪器是否合格只听仪器室：仪器停用、结论不合格/限用、测量日期早于标定日期或晚于有效期，均不能进入正式成果；
- 哪条读数进入成果只由测量组决定：每条读数可为“采用 / 留档 / 待确认”；同一洞段同一桩号新读数采用后，旧读数自动留档但不删除；
- 正式有效读数 = 测量组“采用”且仪器室档案在测量当日有效；洞段闭合差、草图折线、图幅锚点均只使用这些读数；
- 图幅锚点先按桩号排序洞段，再将锚点在洞段桩号区间中的比例映射为该段有效读数累计长度；无有效读数的洞段不移动原偏移；
- 闭合差 f = √(ΣΔE² + ΣΔN²)，默认阈值 0.25 m，超限时徽标变红并可展开计算过程与排除读数清单；
- 方位角范围 0°–360°，倾角范围 -90°–90°，越界读数会被标记为异常。
