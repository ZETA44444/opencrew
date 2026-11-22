export const SHAPES = ['circle', 'square', 'diamond', 'hexagon', 'triangle'];
export const COLORS = ['#e5e5e5', '#7dd3fc', '#fca5a5', '#86efac', '#fcd34d', '#c4b5fd', '#f9a8d4', '#fdba74'];

export default function Avatar({ bot, size = 32 }) {
  return (
    <div className={`avatar shape-${bot.shape || 'circle'}`} style={{ width: size, height: size, background: bot.color, fontSize: size * 0.42 }}>
      <span>{(bot.name || '?').slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
