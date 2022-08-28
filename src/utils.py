import signal


def go_changer(obj):
    obj.go = not obj.go
    signal.signal(obj.handled, obj.defaul_handler)


class SignalHandler:
    def __init__(self, replacement_handler=None, handled=signal.SIGINT) -> None:
        self.handled = handled
        self.defaul_handler = signal.getsignal(handled)

        if replacement_handler is None:
            self.replacement_handler = lambda *_: go_changer(self)
        else:
            self.replacement_handler = replacement_handler

    def __enter__(self):
        self.go = True
        signal.signal(self.handled, self.replacement_handler)

    def __exit__(self, *_):
        pass
