---
slug: tislelizumab
locale: zh
company: beigene
genericName: 替雷利珠单抗(tislelizumab)
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
  simple: T 细胞是免疫系统里专门清除癌细胞的"卫兵"。它身上有个叫 PD-1 的"刹车",本来是防止它误伤正常细胞的。狡猾的癌细胞会打出一个叫 PD-L1 的"信号"去踩住这个刹车,让卫兵误以为"是自己人"而停手。替雷利珠单抗是一种抗 PD-1 抗体,它挡在刹车上,癌细胞就踩不动了,卫兵重新清醒过来,继续攻击癌细胞。与早期同类相比,它特意改造了抗体的 Fc"尾巴"、减少与巨噬细胞的结合,避免刚起效的 T 细胞反被巨噬细胞"吃掉"(清除)。
  advanced: 替雷利珠单抗是一种抗 PD-1 的单克隆抗体(一种能精准找到目标的蛋白质药物)。它结合在 T 细胞表面的 PD-1 上,挡住肿瘤细胞用 PD-L1、PD-L2 去踩这个"刹车",从而解除对 T 细胞的压制,让免疫系统重新识别并杀死肿瘤。它在设计上特意减少了与巨噬细胞上一个受体的结合,避免起效的 T 细胞被误清除。
media:
  - type: animation
    animationKey: pd1-checkpoint-fc-silent
    alt: 动画演示替雷利珠单抗结合 T 细胞的 PD-1、阻断肿瘤 PD-L1 抑制信号使 T 细胞恢复攻击;其经过改造的 Fc 让巨噬细胞抓不住它,避免起效的 T 细胞被误清除。
    caption: 替雷利珠单抗(Fc 改造抗 PD-1,兼防 T 细胞被误清除)作用示意动画
    status: ready
citations:
  - title: "Drug Trials Snapshots:TEVIMBRA"
    publisher: 美国 FDA
    url: https://www.fda.gov/drugs/drug-approvals-and-databases/drug-trials-snapshots-tevimbra
    sourceType: regulator
  - title: "Tislelizumab-jsgr(美国国家癌症研究所 NCI)"
    publisher: 美国国家癌症研究所(NCI)
    url: https://www.cancer.gov/about-cancer/treatment/drugs/tislelizumab-jsgr
    sourceType: gov
review:
  reviewer: auto
  checkedOn: 2026-08-03
  confidence: high
reviewStatus: reviewed
updatedDate: 2026-08-03
---
替雷利珠单抗(百泽安 / Tevimbra)是百济神州研发的抗 PD-1 单克隆抗体。
