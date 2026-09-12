import type { ReactElement } from 'react';

export default function Home(): ReactElement {
  return (
    <div className="stack">
      <h1>NX Trust</h1>
      <p className="muted">
        سجل حيّ لكل كيان، بمصدره وختمه الزمني. ابدأ من السجل أو من إعدادات مدد الصلاحية.
      </p>
      <div className="row">
        <a className="btn-primary" href="/registry">
          افتح السجل
        </a>
      </div>
    </div>
  );
}
