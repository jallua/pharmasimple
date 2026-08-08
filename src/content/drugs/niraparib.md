---
slug: niraparib
locale: zh
company: zai-lab
genericName: 尼拉帕利
genericNameEn: niraparib
brandName: 则乐(Zejula)
drugClass: PARP 抑制剂
popularity: 53
summary: 一种 PARP 抑制剂:堵住癌细胞修补 DNA 断裂的"修理工"(PARP),让本就不擅修复的癌细胞(如 BRCA 突变)因 DNA 损伤累积而死亡;用于卵巢癌维持治疗。由再鼎医药在大中华区开发上市(源自 GSK / Tesaro)。
indications:
  - region: 中国
    regulator: NMPA
    items:
      - 卵巢癌、输卵管癌或原发性腹膜癌的维持治疗
    asOf: "2025"
  - region: 美国
    regulator: FDA
    items:
      - 上皮性卵巢癌、输卵管癌或原发性腹膜癌的维持治疗
target:
  name: 聚(ADP-核糖)聚合酶(PARP)
  type: enzyme
  role: 负责修补单链 DNA 断裂的"修理工"酶;某些癌细胞尤其依赖它来维持存活。
mechanism:
  analogy: 细胞的 DNA 会时不时"划破",PARP 是随叫随到的"补丁工"。癌细胞(尤其 BRCA 突变的)本来另一套修复系统就坏了,全靠 PARP 兜底。这个药把 PARP 也摁住,断口越积越多,癌细胞自己垮掉。
  simple: DNA 出现单链断裂时,PARP 这个酶负责"打补丁"修复。像 BRCA 突变的癌细胞,另一条 DNA 修复通路(同源重组)本来就失灵,只能靠 PARP 硬撑。尼拉帕利抑制 PARP,还把它"钉"在 DNA 上,导致断裂无法修复、不断累积,癌细胞因"合成致死"而死亡,而正常细胞相对能扛。口服给药。
  advanced: 尼拉帕利是一种口服 PARP-1 / PARP-2 抑制剂,除抑制 PARP 催化活性外,还促进 PARP-DNA 复合物"捕获"(trapping);在同源重组修复缺陷(如 BRCA 突变、HRD 阳性)的肿瘤中,通过合成致死机制导致 DNA 双链断裂累积、基因组不稳定,使癌细胞死亡。用于卵巢癌等的维持治疗。
media:
  - type: animation
    animationKey: parp-inhibitor
    alt: 动画演示 PARP 抑制剂摁住癌细胞的 DNA 修复酶,DNA 断裂无法修复、不断累积,最终癌细胞死亡。
    caption: PARP 抑制剂(尼拉帕利)作用示意动画
    status: ready
citations:
  - title: "FDA 说明书:ZEJULA(尼拉帕利)"
    id: cite-1852f6fff9b31086
    sourceId: us-dailymed
    publisher: 美国 FDA(DailyMed)
    url: https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=b7f675e2-159c-490c-b6f4-3f16d9492b7d
    sourceType: regulator
  - title: "Niraparib Tosylate Monohydrate(美国国家癌症研究所 NCI)"
    id: cite-f72b3bd39e5a4abb
    sourceId: us-nci
    publisher: 美国国家癌症研究所(NCI)
    url: https://www.cancer.gov/about-cancer/treatment/drugs/niraparibtosylatemonohydrate
    sourceType: gov
verification:
  status: stale
  checkedAt: 2026-08-03
  nextCheckAt: 2027-02-07
  pipelineVersion: legacy-lkg-v1
legacyLkg:
  snapshotId: legacy-lkg-2026-08-08
  capturedAt: 2026-08-08
  migrateBy: 2027-02-07
reviewStatus: reviewed
updatedDate: 2026-08-03
---
尼拉帕利(商品名 则乐 / Zejula)是再鼎医药在大中华区开发上市的 PARP 抑制剂,用于卵巢癌等的维持治疗。
