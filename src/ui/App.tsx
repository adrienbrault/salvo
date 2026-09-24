import { useEffect, useState } from 'preact/hooks';
import { Chassis } from './screens/Chassis';
import { Hud } from './screens/Hud';
import { Modals } from './screens/Modals';
import { Pause } from './screens/Pause';
import { Recap } from './screens/Recap';
import { GameOver, Victory } from './screens/RunEnd';
import { SectorMap } from './screens/SectorMap';
import { Shop } from './screens/Shop';
import { Boot, BootError, Title } from './screens/Title';
import { type Screen, ui } from './store';

/** Screen router + global overlays (modals, toasts). */
export function App() {
  const err = ui.bootError.value;
  const screen = ui.screen.value;
  useEffect(() => {
    ui.modal.value = null;
  }, [screen]);
  if (err) return <BootError message={err} />;
  return (
    <>
      <ScreenView screen={screen} />
      {screen === 'level' && ui.paused.value && <Pause />}
      <Modals />
      <Toast />
    </>
  );
}

function ScreenView({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'boot':
      return <Boot />;
    case 'title':
      return <Title />;
    case 'chassis':
      return <Chassis />;
    case 'map':
      return <SectorMap />;
    case 'level':
      return <Hud />;
    case 'recap':
      return <Recap />;
    case 'shop':
      return <Shop />;
    case 'over':
      return <GameOver />;
    case 'victory':
      return <Victory />;
  }
}

function Toast() {
  const t = ui.toast.value;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!t) return;
    setShown(t.id);
    const timer = setTimeout(() => setShown(null), 2200);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t || shown !== t.id) return null;
  return (
    <div class="toast" key={t.id} role="status">
      {t.text}
    </div>
  );
}
