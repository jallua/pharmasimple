---
slug: elasomeran
locale: zh
company: moderna
genericName: 新型冠状病毒 mRNA 疫苗
genericNameEn: elasomeran
brandName: Spikevax(莫德纳)
drugClass: mRNA 疫苗
popularity: 88
summary: 一种新冠 mRNA 疫苗:把一段"制造图纸"(mRNA)送进人体细胞,让细胞自己造出病毒的刺突蛋白片段,免疫系统提前"认脸"并练出抗体;用于预防新冠(COVID-19)。由莫德纳(Moderna)研发。
indications:
  - region: 美国
    regulator: FDA
    items:
      - 预防新型冠状病毒感染(COVID-19)
    asOf: "2025"
  - region: 欧盟
    regulator: EMA
    items:
      - 预防新型冠状病毒感染(COVID-19)
target:
  name: 新冠病毒刺突蛋白(SARS-CoV-2 Spike)
  type: protein
  role: 病毒表面用来"开锁"、入侵人体细胞的关键蛋白;疫苗把它当成"通缉画像",教免疫系统提前认出病毒。
mechanism:
  analogy: 疫苗像一张"通缉画像的印刷图纸"。它把图纸(mRNA)送进细胞,让细胞照着印出病毒的"脸"(刺突蛋白片段),免疫系统看过就记住,真病毒一露面就能马上抓。
  simple: 疫苗里是一段 mRNA(相当于造刺突蛋白的"图纸"),外面裹着一层脂质小泡保护它。图纸进入细胞后,细胞的"蛋白质工厂"照着造出病毒刺突蛋白的无害片段并展示出来;免疫系统认出这是"外来的",于是产生抗体、记住病毒的样子。等真病毒来了,身体能更快识别、更快清除。图纸用完很快被降解,不会改变人的基因。elasomeran(莫德纳 Spikevax)与辉瑞/BioNTech 的 tozinameran 机制几乎相同,主要区别在研发厂商与脂质纳米颗粒(LNP)配方;它每剂含有的 mRNA 量相对更高,早期所需的冷链储存条件也相对没那么苛刻。
  advanced: elasomeran(mRNA-1273)是一种核苷修饰的 mRNA 疫苗,编码经稳定化处理的 SARS-CoV-2 刺突(S)糖蛋白,包裹于脂质纳米颗粒(LNP)中递送。mRNA 进入细胞质后由核糖体翻译出 S 抗原,经加工提呈,诱导针对刺突蛋白的体液(中和抗体)与细胞(T 细胞)免疫应答;mRNA 不进入细胞核、不整合基因组,并在翻译后被细胞内核酸酶降解。
media:
  - type: animation
    animationKey: mrna-vaccine
    alt: 动画演示 mRNA 疫苗把刺突蛋白"图纸"送进细胞,细胞照着造出刺突蛋白片段,免疫系统据此产生抗体、获得保护。
    caption: mRNA 疫苗(elasomeran)作用示意动画
    status: ready
citations:
  - title: "FDA 说明书:SPIKEVAX(COVID-19 mRNA 疫苗)"
    id: cite-031ec121b303c7a1
    sourceId: us-dailymed
    publisher: 美国 FDA(DailyMed)
    url: https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=f96b315c-fa57-4876-a7e5-a9b584d8e6e6
    sourceType: regulator
  - title: "mRNA 疫苗如何工作(MedlinePlus Genetics)"
    id: cite-28bfcfe30f1b4fa4
    sourceId: us-medlineplus
    publisher: 美国国立医学图书馆 MedlinePlus
    url: https://medlineplus.gov/genetics/understanding/therapy/mrnavaccines/
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
elasomeran(商品名 Spikevax)是莫德纳(Moderna)研发的新冠 mRNA 疫苗。
