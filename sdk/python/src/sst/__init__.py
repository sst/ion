import json
import os
from typing import Dict, Any, Type, Union
import inspect


# Define a base class for dynamic resource objects
class DynamicResource:
    def __init__(self, data: Dict[str, Any]):
        self._data = data

    def __getattr__(self, name: str) -> Any:
        if name in self._data:
            return self._data[name]
        raise AttributeError(f"Attribute '{name}' not found in resource.")

    def to_dict(self) -> Dict[str, Any]:
        return self._data


def create_resource_class(attributes: Dict[str, Type]) -> Type[DynamicResource]:
    return DynamicResource


class ResourceProxy:
    _cached_config_path = None

    def __init__(
        self, config_filename: str = "resources.json", config_path: str = None
    ):
        self._raw: Dict[str, Any] = {}
        self._resource_classes: Dict[str, Type[DynamicResource]] = {}
        if config_path:
            # If a custom path is provided, use it
            self._load_resources_from_path(config_path)
        else:
            # Otherwise, search for the default config file
            if not ResourceProxy._cached_config_path:
                ResourceProxy._cached_config_path = self._find_resources_file(
                    config_filename
                )
            self._load_resources_from_path(ResourceProxy._cached_config_path)

    def _find_resources_file(self, filename: str) -> str:
        """
        Traverse up the directory tree from the caller's directory to find the resources.json file.
        """
        # Use inspect to get the caller's frame
        frame = inspect.currentframe()
        try:
            # Go back two frames: current frame -> __init__ -> caller
            caller_frame = frame.f_back.f_back
            caller_file = caller_frame.f_code.co_filename
            caller_dir = os.path.dirname(os.path.abspath(caller_file))
        except Exception:
            # Fallback to current working directory
            caller_dir = os.getcwd()
        finally:
            del frame  # Avoid reference cycles

        current_dir = caller_dir
        root_dir = os.path.abspath(os.sep)

        while True:
            potential_path = os.path.join(current_dir, filename)
            if os.path.isfile(potential_path):
                return potential_path
            if current_dir == root_dir:
                break
            # Move one directory up
            current_dir = os.path.dirname(current_dir)

        raise FileNotFoundError(
            f"Configuration file '{filename}' not found in '{caller_dir}' or any parent directories."
        )

    def _load_resources_from_path(self, path: str):
        try:
            with open(path, "r") as f:
                resources_data = json.load(f)
        except FileNotFoundError as e:
            raise FileNotFoundError(
                f"Unable to locate configuration file at '{path}'. Please ensure it exists."
            ) from e
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in '{path}': {e}") from e

        if not isinstance(resources_data, dict):
            raise ValueError(
                f"Configuration file '{path}' must contain a JSON object at the top level."
            )

        for resource_key, data in resources_data.items():
            if isinstance(data, dict):
                # Create a resource class based on the keys in the data
                attributes = {k: type(v) for k, v in data.items()}
                self._resource_classes[resource_key] = create_resource_class(attributes)
                self._raw[resource_key] = self._resource_classes[resource_key](data)
            else:
                self._raw[resource_key] = data

    def __getattr__(self, name: str) -> Union[DynamicResource, Any]:
        if name in self._raw:
            return self._raw[name]
        raise AttributeError(f"Resource '{name}' not found.")


# Initialize the proxy object with the default configuration file name
Resource = ResourceProxy("resources.json")
