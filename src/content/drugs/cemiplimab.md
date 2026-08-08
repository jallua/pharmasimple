---
slug: cemiplimab
locale: zh
company: regeneron
genericName: 西米普利单抗
genericNameEn: cemiplimab
brandName: Libtayo
drugClass: 抗 PD-1 单克隆抗体(免疫检查点抑制剂)
popularity: 48
summary: 一种免疫检查点抑制剂:松开免疫细胞的"刹车",让身体的免疫系统重新去攻击癌细胞;主要用于晚期皮肤癌等;由再生元研发。
indications:
  - region: 美国
    regulator: FDA
    items:
      - 皮肤鳞状细胞癌(CSCC,转移性或局部晚期,不适合手术或放疗)
      - 基底细胞癌(BCC,局部晚期或转移性,经 Hedgehog 通路抑制剂治疗后或不适合该治疗)
      - 非小细胞肺癌(NSCLC,PD-L1 高表达且无 EGFR/ALK/ROS1 突变;单药一线,或联合含铂化疗)
    asOf: "2025"
  - region: 欧盟
    regulator: EMA
    items:
      - 皮肤鳞状细胞癌(CSCC)
      - 基底细胞癌(BCC)
      - 非小细胞肺癌(NSCLC) 等
target:
  name: 程序性死亡受体 1(PD-1)
  type: receptor
  role: 长在 T 细胞(免疫卫兵)表面的一个"刹车";被癌细胞按下后,卫兵就会停止攻击。
mechanism:
  analogy: 身体里有专门追杀癌细胞的"免疫卫兵"(T 细胞),可癌细胞会偷偷给卫兵"踩刹车",让它停手不打。西米普利单抗的作用就是松开这个刹车,让免疫卫兵重新去清除癌细胞。
  simple: T 细胞是免疫系统里专门清除癌细胞的"卫兵",它身上有个叫 PD-1 的"刹车",本来是防止它误伤正常细胞的。狡猾的癌细胞会打出一个叫 PD-L1 的"信号"去踩住这个刹车,让卫兵误以为"是自己人"而停手。西米普利单抗是一种抗 PD-1 抗体,它挡在刹车上,癌细胞就踩不动了,卫兵重新清醒过来,继续攻击癌细胞。它是首个获批用于晚期皮肤鳞状细胞癌(cSCC)的 PD-1 抑制剂。
  advanced: 西米普利单抗是一种抗 PD-1 的全人源单克隆抗体。它结合 T 细胞表面的 PD-1,阻断肿瘤细胞用 PD-L1、PD-L2 去踩这个"刹车",从而解除对 T 细胞的压制,让免疫系统重新识别并杀死肿瘤细胞。
media:
  - type: animation
    animationKey: pd1-checkpoint
    alt: 动画演示西米普利单抗结合 T 细胞的 PD-1,阻断肿瘤 PD-L1 的抑制信号,使 T 细胞恢复攻击。
    caption: 西米普利单抗解除 PD-1 刹车的示意动画
    status: ready
citations:
  - title: "Cemiplimab-rwlc(美国国家癌症研究所 NCI)"
    id: cite-d1c413638d9bec2f
    sourceId: us-nci
    publisher: 美国国家癌症研究所(NCI)
    url: https://www.cancer.gov/about-cancer/treatment/drugs/cemiplimab-rwlc
    sourceType: gov
  - title: "FDA 说明书:LIBTAYO(西米普利单抗)"
    id: cite-a044213178fdb345
    sourceId: us-dailymed
    publisher: 美国 FDA(DailyMed)
    url: https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=4347ae1f-d397-4f18-8b70-03897e1c054a
    sourceType: regulator
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
西米普利单抗(Libtayo)是再生元研发的抗 PD-1 单克隆抗体。
