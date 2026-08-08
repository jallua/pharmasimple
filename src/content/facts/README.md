# 结构化事实集合

此目录只保存经过 `scripts/import-verified-content.ts --apply` 校验并导入的 v2 `AtomicFact` JSON。
采集器和导入器不得修改 `src/content/drugs/*.md` 中的科普文案；文案与事实之间通过人工复核的 `factRefs` 关联。


公开页面只有在显式使用 verification schema v2、且每个受信事实叶均有有效 `factRef` 时才能标记为 `verified`。`supports` 仅用于原子事实直接支持的字段，`contextualizes` 表示产品或靶点事实提供上下文，`derived-from` 表示科普文案由结构化事实经编辑复核后推导；三者都会绑定当前文案摘要和事实修订摘要，文案或事实任一变化都必须重新复核。
