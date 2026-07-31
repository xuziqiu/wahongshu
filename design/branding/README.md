# 挖红薯图标源稿

`icon-source.png` 是使用 OpenAI 内置图像生成工具制作的品牌源稿。正式应用图标
不是直接使用整张源图，而是由 `scripts/generate_icon.py` 完成以下处理：

1. 按主体位置裁切为正方形；
2. 缩放为 512×512 PNG；
3. 添加透明圆角；
4. 生成包含 16–256 像素尺寸的 Windows ICO。

重新生成最终图标：

```powershell
python scripts/generate_icon.py
```

最终程序使用 `app/assets/icon.png` 和 `app/assets/icon.ico`。源稿不会被打包进
Electron 应用。
