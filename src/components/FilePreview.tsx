import { useEffect, useState } from 'react';

interface FilePreviewProps {
  file: File;
  className?: string;
}

/**
 * 本地待上传文件的缩略预览。
 * 对象 URL 只在文件变化时创建一次，并在卸载或换文件时释放，
 * 避免在 render 里直接调用 createObjectURL 造成的内存泄漏
 * （一次选几十张大图时尤其明显）。
 */
export default function FilePreview({ file, className }: FilePreviewProps) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      // 不清空的话，换文件后会有一帧仍在渲染已释放的旧地址，闪一下裂图
      setUrl('');
    };
  }, [file]);

  if (!url) return null;

  return <img src={url} alt="" decoding="async" className={className} />;
}