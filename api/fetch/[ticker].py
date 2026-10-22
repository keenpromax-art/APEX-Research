import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python_lib"))

from handler import FetchHandler

handler = FetchHandler
