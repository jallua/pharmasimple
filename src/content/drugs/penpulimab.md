---
slug: penpulimab
locale: zh
company: akeso
genericName: 派安普利单抗(penpulimab)
brandName: 安尼可(Anniko)
drugClass: 抗 PD-1 单克隆抗体(免疫检查点抑制剂)
popularity: 44
summary: 一种免疫检查点抑制剂:松开免疫细胞的"刹车",让免疫系统重新攻击癌细胞;主要用于鼻咽癌等;由康方生物研发,已在中国和美国获批。
indications:
  - region: 美国
    regulator: FDA
    items:
      - 复发或转移性非角化型鼻咽癌(一线,联合顺铂或卡铂与吉西他滨)
      - 非角化型鼻咽癌(既往治疗后进展,单药)
    asOf: "2025"
  - region: 中国
    regulator: NMPA
    items:
      - 复发 / 难治性经典霍奇金淋巴瘤
      - 复发或转移性鼻咽癌
      - 鳞状非小细胞肺癌(联合化疗) 等
    asOf: "2025"
target:
  name: 程序性死亡受体 1(PD-1)
  type: receptor
  role: 长在 T 细胞(免疫卫兵)表面的一个"刹车";被癌细胞按下后,卫兵就会停止攻击。
mechanism:
  analogy: 身体里有专门追杀癌细胞的"免疫卫兵"(T 细胞),可癌细胞会偷偷给卫兵"踩刹车",让它停手不打。派安普利单抗的作用就是松开这个刹车,让免疫卫兵重新去清除癌细胞。
  simple: T 细胞是免疫系统里专门清除癌细胞的"卫兵",它身上有个叫 PD-1 的"刹车",本来是防止它误伤正常细胞的。狡猾的癌细胞会打出一个叫 PD-L1 的"信号"去踩住这个刹车,让卫兵误以为"是自己人"而停手。派安普利单抗是一种抗 PD-1 抗体,它挡在刹车上,癌细胞就踩不动了,卫兵重新清醒过来,继续攻击癌细胞。它的骨架是经过改造的 IgG1:去掉了与巨噬细胞 Fc 受体的结合(不引发 ADCC / ADCP),既避免误清除刚起效的 T 细胞,免疫相关不良反应也相对较少。
  advanced: 派安普利单抗是一种人源化 IgG1 型抗 PD-1 单克隆抗体。它结合 T 细胞表面的 PD-1,阻断肿瘤细胞用 PD-L1、PD-L2 去踩这个"刹车",从而解除对 T 细胞的压制,让免疫系统重新识别并杀死肿瘤。其 IgG1 骨架经工程改造以去除 Fcγ 受体结合,不介导 ADCC / ADCP,从而避免清除起效的 T 细胞并减少促炎细胞因子释放。它由康方生物研发,已在中国与美国获批。
media:
  - type: animation
    animationKey: pd1-checkpoint-fc-silent
    alt: 动画演示派安普利单抗结合 T 细胞的 PD-1、阻断肿瘤 PD-L1 抑制信号使 T 细胞恢复攻击;其 Fc 经改造后巨噬细胞抓不住它,避免起效的 T 细胞被误清除。
    caption: 派安普利单抗(Fc 改造 IgG1 抗 PD-1)作用示意动画
    status: ready
citations:
  - title: "FDA 批准 penpulimab-kcqx 用于非角化型鼻咽癌"
    publisher: 美国 FDA
    url: https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-penpulimab-kcqx-non-keratinizing-nasopharyngeal-carcinoma
    sourceType: regulator
  - title: "Drug Trials Snapshots:PENPULIMAB-KCQX(美国 FDA)"
    publisher: 美国 FDA
    url: https://www.fda.gov/drugs/drug-approvals-and-databases/drug-trials-snapshots-penpulimab-kcqx
    sourceType: gov
review:
  reviewer: auto
  checkedOn: 2026-08-03
  confidence: high
reviewStatus: reviewed
updatedDate: 2026-08-03
---
派安普利单抗(安尼可 / Anniko)是康方生物研发的抗 PD-1 单克隆抗体。
