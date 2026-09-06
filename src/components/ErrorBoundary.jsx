import { Component } from 'react';

/**
 * 렌더링 중 예외가 나면 React 는 트리 전체를 언마운트한다 → 화면이 하얗게 빈다.
 * 사용자 입장에서는 앱이 죽은 것과 구분되지 않으므로, 최소한 무슨 일이 났고
 * 무엇을 하면 되는지는 보여준다.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 배포 환경에서도 콘솔에는 남겨 원인을 추적할 수 있게 한다
    // eslint-disable-next-line no-console
    console.error('[medi365] 렌더링 오류', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="text-base font-bold">화면을 표시하지 못했습니다</p>
          <p className="mt-2 leading-relaxed">
            일시적인 문제일 수 있습니다. 새로고침해도 같으면 잠시 후 다시 시도해 주세요.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary h-11 flex-1 text-sm"
            >
              ↻ 새로고침
            </button>
            <button
              type="button"
              onClick={() => window.location.replace(`/?v=${Date.now()}`)}
              className="btn-ghost h-11 flex-1 text-sm"
            >
              캐시 지우고 열기
            </button>
          </div>

          <details className="mt-4 text-xs text-rose-600">
            <summary className="cursor-pointer">오류 내용</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2">
              {String(error?.message || error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
