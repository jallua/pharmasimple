---
slug: tislelizumab
locale: zh
company: beigene
genericName: 替雷利珠单抗
genericNameEn: tislelizumab
brandName: 百泽安(Tevimbra)
drugClass: 抗 PD-1 单克隆抗体(免疫检查点抑制剂)
popularity: 65
summary: 一种免疫检查点抑制剂:松开免疫细胞的"刹车",让身体的免疫系统重新去攻击癌细胞。由百济神州研发。
indications:
  - region: 美国
    regulator: FDA
    items:
      - 不可切除或转移性食管鳞癌(ESCC,既往化疗后;单药)
      - 一线不可切除 / 转移性食管鳞癌(ESCC,PD-L1≥1;联合化疗)
      - 一线 HER2 阴性胃 / 胃食管结合部腺癌(G/GEJ,PD-L1≥1;联合化疗)
    asOf: "2025"
  - region: 欧盟
    regulator: EMA
    items:
      - 食管鳞癌(ESCC,既往化疗后)
      - "非小细胞肺癌(NSCLC:一线联合化疗;二线单药)"
  - region: 中国
    regulator: NMPA
    items:
      - 经典霍奇金淋巴瘤(复发 / 难治)
      - 尿路上皮癌(PD-L1 高表达,含铂化疗后)
      - 非小细胞肺癌(鳞状一线 + 化疗;非鳞一线 + 化疗;二线单药)
      - 肝细胞癌(既往系统治疗后)
      - 食管鳞癌(二线单药;一线 + 化疗)
      - 鼻咽癌(一线 + 化疗)
      - 胃 / 胃食管结合部腺癌(一线 + 化疗)
      - 高微卫星不稳定性(MSI-H / dMMR)实体瘤
    asOf: "2025"
target:
  name: 程序性死亡受体 1(PD-1)
  type: receptor
  role: 长在 T 细胞(免疫卫兵)表面的一个"刹车";被癌细胞按下后,卫兵就会停止攻击。
mechanism:
  analogy: 身体里有专门追杀癌细胞的"免疫卫兵"(T 细胞),可癌细胞会偷偷给卫兵"踩刹车",让它停手不打。替雷利珠单抗的作用就是松开这个刹车,让免疫卫兵重新去清除癌细胞。
  simple: 替雷利珠单抗是一种经 Fc 工程改造的人源化 IgG4κ 抗 PD-1 单克隆抗体，可结合 PD-1 并阻断 PD-1 与 PD-L1、PD-L2 的相互作用，从而解除 PD-1 通路对免疫反应的抑制。
  advanced: 替雷利珠单抗是一种抗 PD-1 的单克隆抗体(一种能精准找到目标的蛋白质药物)。它结合在 T 细胞表面的 PD-1 上,挡住肿瘤细胞用 PD-L1、PD-L2 去踩这个"刹车",从而解除对 T 细胞的压制,让免疫系统重新识别并杀死肿瘤。它在设计上特意减少了与巨噬细胞上一个受体的结合,避免起效的 T 细胞被误清除。
media:
  - type: animation
    animationKey: pd1-checkpoint-fc-silent
    alt: 动画演示替雷利珠单抗结合 T 细胞的 PD-1、阻断肿瘤 PD-L1 抑制信号使 T 细胞恢复攻击;其经过改造的 Fc 让巨噬细胞抓不住它,避免起效的 T 细胞被误清除。
    caption: 替雷利珠单抗(Fc 改造抗 PD-1,兼防 T 细胞被误清除)作用示意动画
    status: ready
citations:
  - title: "Drug Trials Snapshots:TEVIMBRA"
    id: cite-905f94241aa7f3b8
    sourceId: us-fda
    publisher: 美国 FDA
    url: https://www.fda.gov/drugs/drug-approvals-and-databases/drug-trials-snapshots-tevimbra
    sourceType: regulator
  - title: "Tislelizumab-jsgr(美国国家癌症研究所 NCI)"
    id: cite-94eb0f3188945618
    sourceId: us-nci
    publisher: 美国国家癌症研究所(NCI)
    url: https://www.cancer.gov/about-cancer/treatment/drugs/tislelizumab-jsgr
    sourceType: gov
  - title: "DailyMed：TEVIMBRA（替雷利珠单抗）处方信息"
    id: cite-4b19bdc8ae83dde7
    sourceId: us-dailymed
    publisher: 美国国家医学图书馆 DailyMed
    url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=08ef1e3e-496f-4b0b-94ee-fbba3cc1985a
    retrievedDate: 2026-08-08
    sourceType: label
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
updatedDate: 2026-08-08
---
替雷利珠单抗(百泽安 / Tevimbra)是百济神州研发的抗 PD-1 单克隆抗体。
