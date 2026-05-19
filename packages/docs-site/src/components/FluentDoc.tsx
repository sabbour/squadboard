import {useState, type ComponentType, type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';

type FluentIcon = ComponentType<{className?: string; 'aria-hidden'?: boolean}>;

export function IconGrid({children}: {children: ReactNode}) {
  return <div className="fluent-icon-grid">{children}</div>;
}

export function IconCard({
  icon: Icon,
  title,
  to,
  children,
}: {
  icon: FluentIcon;
  title: string;
  to?: string;
  children: ReactNode;
}) {
  const content = (
    <>
      <Icon className="fluent-icon-card__icon" aria-hidden />
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </>
  );

  if (to) {
    return (
      <Link className="fluent-icon-card" to={to}>
        {content}
      </Link>
    );
  }

  return (
    <div className="fluent-icon-card">
      {content}
    </div>
  );
}

export function ScreenshotGrid({children}: {children: ReactNode}) {
  return <div className="screenshot-grid">{children}</div>;
}

export function Screenshot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  const imageSrc = useBaseUrl(src);
  const [open, setOpen] = useState(false);

  return (
    <figure className="doc-screenshot">
      <button
        type="button"
        className="doc-screenshot__trigger"
        onClick={() => setOpen(true)}
        aria-label={`Open larger screenshot: ${alt}`}
      >
        <img src={imageSrc} alt={alt} />
        <span className="doc-screenshot__hint">Open larger</span>
      </button>
      {caption && <figcaption>{caption}</figcaption>}
      {open && (
        <div
          className="doc-screenshot-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="doc-screenshot-lightbox__close"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
          <img
            className="doc-screenshot-lightbox__image"
            src={imageSrc}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </figure>
  );
}

export function ScenarioFlow({children}: {children: ReactNode}) {
  return <div className="scenario-flow">{children}</div>;
}
