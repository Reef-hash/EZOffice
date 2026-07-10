import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '../Button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleCopyError = () => {
    if (!this.state.error) return
    const errorText = `${this.state.error.toString()}\n\nStack:\n${this.state.errorInfo?.componentStack || ''}`
    navigator.clipboard.writeText(errorText).then(
      () => {
        this.setState({ copied: true })
        setTimeout(() => this.setState({ copied: false }), 2000)
      },
      (err) => {
        console.error('Could not copy error details:', err)
      }
    )
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-surface p-8 shadow-md">
            {/* Inline SVG Warning/Error Icon */}
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-50 text-error-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-6 w-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>

            <h1 className="mb-2 text-xl font-bold text-neutral-900">Something went wrong</h1>
            <p className="mb-6 text-sm text-neutral-600">
              An unexpected error has occurred in the application. You can try reloading or copy the details to report the issue.
            </p>

            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={this.handleCopyError}>
                {this.state.copied ? 'Copied!' : 'Copy error'}
              </Button>
              <Button variant="primary" onClick={this.handleReload}>
                Reload
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
