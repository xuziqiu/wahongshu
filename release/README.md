# Release 目录

本地执行 `npm run dist:local` 后，最终可直接运行的 Windows GUI 和 CLI 便携版
会生成在这里。两者都是自包含 EXE，并各自带有 SHA-256 校验文件。

`release` 中的二进制文件不提交到 Git；正式公开版本应作为 GitHub Release
附件发布。仓库只跟踪本说明文件。
