import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../lib/socket';
import { useAuthStore } from '../store/auth';
import { useConnectionStore } from '../store/connection';

// Queries that carry live stock data — refetched after a reconnect because we
// may have missed `stock-update` events while the socket was down.
const LIVE_QUERY_KEYS = [['tracking'], ['products'], ['product'], ['alerts']];

/**
 * Tracks Socket.io connection state into the connection store (for the navbar
 * indicator) and, crucially, re-syncs data on reconnect so the UI can't sit on
 * stale stock after a network blip. Mounted once at the app root.
 */
export function useSocketConnection() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setStatus = useConnectionStore((s) => s.setStatus);

  useEffect(() => {
    if (!user) {
      setStatus('disconnected');
      return;
    }

    const socket = getSocket();
    setStatus(socket.connected ? 'connected' : 'reconnecting');

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('reconnecting');
    const onConnectError = () => setStatus('reconnecting');
    const onReconnectAttempt = () => setStatus('reconnecting');
    const onReconnect = () => {
      setStatus('connected');
      // The whole point: catch up on anything missed while disconnected.
      LIVE_QUERY_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    // Reconnect lifecycle lives on the Manager (socket.io), not the socket.
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect', onReconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect', onReconnect);
    };
  }, [user, qc, setStatus]);
}
