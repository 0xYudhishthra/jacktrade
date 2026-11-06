import { Link } from '@tanstack/react-router';

export default function GlassButton({ to, children, className = '', primary = false, ...props }) {
  const classes = `dream-glass ${primary ? 'dream-glass-primary' : ''} ${className}`;
  return to ? <Link to={to} className={classes} {...props}>{children}</Link>
    : <button type="button" className={classes} {...props}>{children}</button>;
}
