import { useState } from 'react';

interface StoreLogoProps {
  logoUrl?: string | null;
  domain?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function StoreLogo({ logoUrl, domain, name, size = 'md', className = '' }: StoreLogoProps) {
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
  };

  const googleFavicon = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    : null;

  const src = !failed ? logoUrl : (!triedFallback ? googleFavicon : null);

  const handleError = () => {
    if (!failed) {
      setFailed(true); // try google favicon
    } else {
      setTriedFallback(true); // show avatar
    }
  };

  if (!src || (failed && triedFallback)) {
    return (
      <div className={`${sizeClasses[size]} rounded-full bg-dark-surface2 border border-dark-separator flex items-center justify-center font-bold text-white shrink-0 ${className}`}>
        {name?.[0]?.toUpperCase() ?? '?'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      onError={handleError}
      className={`${sizeClasses[size]} rounded-full object-contain bg-white p-1 border border-dark-separator shrink-0 ${className}`}
    />
  );
}
