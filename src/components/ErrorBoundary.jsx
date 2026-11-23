import { Component } from 'react';

// If a part of the app fails, show what happened instead of a black screen.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('OpenCrew:', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const reset = () => { this.setState({ error: null }); this.props.onReset?.(); };
    return (
      <div className={this.props.inline ? 'modal-backdrop' : 'loading server-offline'}>
        <div className={this.props.inline ? 'modal' : ''} style={{ padding: 20, textAlign: 'center' }}>
          <div>⚠️ Algo ha fallado en esta pantalla.</div>
          <div className="muted small" style={{ margin: '8px 0' }}>{String(this.state.error?.message || this.state.error)}</div>
          <div className="card-actions" style={{ justifyContent: 'center' }}>
            {this.props.inline && <button className="btn small primary" onClick={reset}>Cerrar</button>}
            <button className="btn small ghost" onClick={() => location.reload()}>Recargar la app</button>
          </div>
        </div>
      </div>
    );
  }
}
