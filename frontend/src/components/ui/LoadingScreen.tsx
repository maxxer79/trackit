export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-apple-blue flex items-center justify-center shadow-glow-blue">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 4L6 10v14h5v-8h6v8h5V10L14 4z" fill="white" />
          </svg>
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-apple-blue animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
