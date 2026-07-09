export default function WorkerLoading() {
  return (
    <div className="p-4 flex flex-col gap-4 max-w-md mx-auto">
      <div className="h-6 w-32 bg-gray-200 rounded-lg animate-pulse" />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2].map(i => (
          <div key={i} className="rounded-2xl border border-gray-200/80 bg-white p-4">
            <div className="h-8 w-8 bg-gray-200 rounded-xl animate-pulse mb-3" />
            <div className="h-5 w-16 bg-gray-200 rounded animate-pulse mb-1" />
            <div className="h-3 w-12 bg-gray-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-gray-200/80 rounded-2xl p-4">
        <div className="h-5 w-28 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="h-[140px] bg-gray-100 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
