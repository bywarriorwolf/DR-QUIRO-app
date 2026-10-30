import { Menu, X } from 'lucide-react';
import { S } from '../../shared/strings';
import logo from '../assets/logo.png';
import type { AuthStatus } from '../../shared/ipc';

interface Props {
  auth: AuthStatus;
  connecting: boolean;
  menuOpen: boolean;
  onConnect(): void;
  onToggleMenu(): void;
  onDisconnect(): void;
}

export function Header({ auth, connecting, menuOpen, onConnect, onToggleMenu, onDisconnect }: Props) {
  return (
    <header className={`header${menuOpen ? ' header--menu' : ''}`}>
      <img className="logo" src={logo} alt="DR·QUIRO" draggable={false} />
      {auth.connected ? (
        <div className="account">
          <span className="account__name">{auth.userName ?? ''}</span>
          <button
            type="button"
            className="icon-button account__menu"
            aria-label={menuOpen ? S.close : S.menu}
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
          >
            {menuOpen ? <X size={28} strokeWidth={2.4} /> : <Menu size={34} strokeWidth={2.4} />}
          </button>
          {menuOpen && (
            <button type="button" className="disconnect" onClick={onDisconnect}>
              {S.disconnectCanva}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="connect" onClick={onConnect} disabled={connecting}>
          {connecting ? S.connecting : S.connectCanva}
        </button>
      )}
    </header>
  );
}
