export default function ManagerLoading() {
  return (
    <div className="p-6 flex flex-col gap-6 max-w-7xl">
      <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-2xl border border-gray-200/80 bg-white p-4">
            <div className="h-9 w-9 bg-gray-200 rounded-xl animate-pulse mb-3" />
            <div className="h-7 w-24 bg-gray-200 rounded animate-pulse mb-1" />
            <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-gray-200/80 rounded-2xl p-5">
        <div className="h-6 w-36 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="h-[220px] bg-gray-100 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
