import { useEffect, useState } from "react";
import { cachedImageFit, measureImageFit, type ImageFit } from "../lib/image-fit";

interface Props {
  src?: string | null;
  className?: string;
  eager?: boolean;
}

/**
 * Renders a product shot zoomed past the whitespace baked into the source JPEG,
 * so the pack itself spans the frame rather than floating in a white square.
 */
export default function Thumb({ src, className = "thumb", eager = false }: Props) {
  const [fit, setFit] = useState<ImageFit | null>(() =>
    src ? (cachedImageFit(src) ?? null) : null,
  );

  useEffect(() => {
    if (!src) return;
    const cached = cachedImageFit(src);
    if (cached !== undefined) {
      setFit(cached);
      return;
    }
    let live = true;
    measureImageFit(src).then((next) => {
      if (live) setFit(next);
    });
    return () => {
      live = false;
    };
  }, [src]);

  if (!src) {
    return <div className={`${className} thumb-empty`} aria-hidden="true" />;
  }

  const style = fit
    ? {
        width: `${fit.widthPct}%`,
        height: `${fit.heightPct}%`,
        left: `${fit.leftPct}%`,
        top: `${fit.topPct}%`,
      }
    : undefined;

  return (
    <img
      className={fit ? `${className} is-fitted` : className}
      style={style}
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
