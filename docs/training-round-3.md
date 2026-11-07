# 第三轮训练复核 · 实测、缺报与预测

## 任务与基线

假设值班员 07:00 接班，全城只有一支补车队。试算采用“同一时刻实测少于 2 辆”作为派车条件，给未上报站另行核实的入口。阈值只用于本次演练。

复核了第二版入口及数据大屏、工作台、质量评审三份参考。已有内容明确区分零值、离线与缺失，要求解释单位及时间范围，并保留了键盘可读的图表摘要。按这些要求能检查单站标签。遇到部分站点缺报，还需要决定区域总量如何命名、缺报站能否进入排序，以及未来数据如何与当前库存并列。以下结果来自数据试算与规范审阅。

## 复现数据

A、B 在东区，C 在西区。每 15 分钟采样，单位为可借车数量。下表的第二行可检验折线在缺报前后能否保持真实的时间间隔。

| 时刻 | 数据性质 | A 站 | B 站 | C 站 |
| --- | --- | ---: | ---: | ---: |
| 06:30 | 实测 | 3 | 3 | 7 |
| 06:45 | 实测 | 缺报 | 4 | 5 |
| 07:00 | 实测 | 0 | 缺报 | 7 |
| 07:15 | 预测 | 4 | 2 | 6 |

假设 07:00 时把缺报值强制转换为数字，`Number(null)` 会得到 0，于是 A、B 两站都满足派车条件。保留缺报时，A 是唯一已知需要补车的站点，B 需要核实。全城实测覆盖两站，合计 7 辆。切到东区，只有 A 上报，已报的 1/2 站共 0 辆。07:15 的全城预测为 12 辆，不能据此推出比 07:00 全城实测“增加 5 辆”。06:45 实测 2/3 站合计 9 辆，与 07:00 同为两站上报，但上报的站点已变化，二者同样不能直接作全城升降比较。

这段代码可在 Node.js 中复核上述数值。

```js
const assert = require('node:assert/strict');
const snapshots = [
  { time: '06:30', kind: 'observed', A: 3, B: 3, C: 7 },
  { time: '06:45', kind: 'observed', A: null, B: 4, C: 5 },
  { time: '07:00', kind: 'observed', A: 0, B: null, C: 7 },
  { time: '07:15', kind: 'forecast', A: 4, B: 2, C: 6 }
];
const stations = ['A', 'B', 'C'];
function reported(row, scope) {
  return scope.filter(station => Number.isFinite(row[station]));
}
function subtotal(row, scope) {
  return reported(row, scope).reduce((sum, station) => sum + row[station], 0);
}
const current = snapshots.find(row => row.time === '07:00' && row.kind === 'observed');
assert.deepEqual(stations.filter(station => Number(current[station]) < 2), ['A', 'B']);
assert.deepEqual(reported(current, stations).filter(station => current[station] < 2), ['A']);
assert.deepEqual(reported(snapshots[1], stations), ['B', 'C']);
assert.deepEqual(reported(current, stations), ['A', 'C']);
assert.equal(subtotal(current, stations), 7);
assert.deepEqual(reported(current, ['A', 'B']), ['A']);
assert.equal(subtotal(current, ['A', 'B']), 0);
assert.equal(subtotal(snapshots.find(row => row.kind === 'forecast'), stations), 12);
```

## 规范调整与资料

- 在已有《大屏与分析看板》内补充折线断点、单个有效点、预测分界和区间来源。前两项适用原本有固定采样频率的实测序列。预测区间在来源提供且影响判断时展示。[ONS 折线图指南](https://service-manual.ons.gov.uk/data-visualisation/chart-types/line-chart) · [ONS 图表中的不确定性](https://service-manual.ons.gov.uk/data-visualisation/guidance/showing-uncertainty-in-charts)
- 用上述站点样本核对覆盖数、小计、排序、选区和时点。将这些经营口径写入同一份调度参考，在《交付与视觉评审》加入对应检查。对固定班次的清单允许保留既定时刻，同时明确其范围。

## 在交付样页里看结果

打开「潮汐调度」：06:15 和 06:30，江湾地铁口缺报，东岸与全市折线断开，西岸仍有实测点。07:00 后进入着色的预测区，折线改为虚线；摘要中的差值也标为“预计净变化”。切到纯实测时段，差值随之标为“实测净变化”。

右侧清单固定按 08:00 的预计缺口排序。东西两岸共用 24 辆运力，为江湾地铁口分配 15 辆后只剩 9 辆可分。这个操作改变调度计划，不改写原始观测或未补车预测。切换区域、刷新和撤销可用来复查库存与计划是否仍然分明。

## 换一个行业还能用吗？

独立试用者只读更新后的 skill 和社区配送需求，用三仓装车量生成了另一张午班工作台。11:45 与 12:00 都是两仓上报，前者共 8 箱，后者共 9 箱，上报的仓却不同。试作明确只有东仓可直接比较（2 箱降到 0 箱），把西仓安排为补报，把未来三仓 14 箱标成预测。它选择等刻度矩阵，而非照搬单车样页的折线图。

该试作在 1366×768 和 390×844 下可在一屏使用，320px 宽度无横向溢出但需要上下滚动。这个结果说明本规则能指导一次不同任务的实现，并不代表所有分析页面都应该使用同一种图表。该配送试作仅作训练复核，不属于六个公开样页。
