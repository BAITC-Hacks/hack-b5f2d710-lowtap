import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import argparse

from app import __version__


def main() -> None:
    parser = argparse.ArgumentParser(description="Бэкенд «Аким на 5 часов»")
    parser.add_argument("--version", action="version", version=__version__)
    parser.parse_args()
    parser.print_help()


if __name__ == "__main__":
    main()
