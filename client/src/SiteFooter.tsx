import { BUILT_BY, COPYRIGHT_HOLDER, COPYRIGHT_YEAR } from "./siteMeta";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer__line">
        © {COPYRIGHT_YEAR} {COPYRIGHT_HOLDER}. All rights reserved.
      </p>
      <p className="site-footer__line site-footer__credit muted small">
        Built by {BUILT_BY}.
      </p>
    </footer>
  );
}
