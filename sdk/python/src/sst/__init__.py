import json
import os
import inspect
import sys
import logging
from typing import Dict, Any, Type, Union
from pathlib import Path

# Configure the logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)  # Set to DEBUG to capture all log messages

# Create console handler with a higher log level
ch = logging.StreamHandler()
ch.setLevel(logging.DEBUG)

# Create formatter and add it to the handlers
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
ch.setFormatter(formatter)

# Add the handlers to the logger
if not logger.handlers:
    logger.addHandler(ch)


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
        logger.debug(
            f"Initializing ResourceProxy with config_filename='{config_filename}', config_path='{config_path}'"
        )
        if config_path:
            logger.debug(f"Custom config_path provided: '{config_path}'")
            # If a custom path is provided, use it
            self._load_resources_from_path(config_path)
        else:
            # Otherwise, search for the default config file
            if not ResourceProxy._cached_config_path:
                logger.debug("No cached config path found. Searching for config file.")
                ResourceProxy._cached_config_path = self._find_resources_file(
                    config_filename
                )
                logger.debug(
                    f"Config file found at: '{ResourceProxy._cached_config_path}'"
                )
            else:
                logger.debug(
                    f"Using cached config path: '{ResourceProxy._cached_config_path}'"
                )
            self._load_resources_from_path(ResourceProxy._cached_config_path)

    def _find_resources_file(self, filename: str) -> str:
        """
        Search for the resources.json file relative to the module that imports ResourceProxy.
        """
        logger.debug(
            f"Starting search for '{filename}' relative to the importing module."
        )
        stack = inspect.stack()
        current_file = Path(__file__).resolve()

        logger.debug(f"Current file path: '{current_file}'")

        # Iterate through the call stack to find the first frame outside this module
        for index, frame_info in enumerate(
            stack[1:], start=1
        ):  # Skip the current frame
            frame_path = Path(frame_info.filename).resolve()
            logger.debug(f"Inspecting frame {index}: '{frame_path}'")

            # Skip frames that are part of this module/package
            if frame_path == current_file:
                logger.debug(
                    f"Skipping frame {index} as it belongs to the ResourceProxy module."
                )
                continue

            # Optionally, skip other internal frames if your package has multiple modules
            # For example, if your package is named 'your_package', skip frames from it
            # Uncomment and modify the following lines if necessary:
            # if 'your_package' in frame_info.filename:
            #     logger.debug(f"Skipping frame {index} as it belongs to 'your_package'.")
            #     continue

            # Use this frame's directory as the base path
            base_path = frame_path.parent
            logger.debug(f"Base path for frame {index}: '{base_path}'")

            # Traverse up from the base path to find the config file
            for parent_index, parent in enumerate(
                [base_path] + list(base_path.parents), start=1
            ):
                potential_path = parent / filename
                logger.debug(
                    f"Checking directory level {parent_index} for frame {index}: '{potential_path}'"
                )
                if potential_path.is_file():
                    logger.debug(
                        f"Config file '{filename}' found at: '{potential_path}'"
                    )
                    return str(potential_path)
                else:
                    logger.debug(
                        f"Config file '{filename}' not found at: '{potential_path}'"
                    )

            # If not found in this frame's hierarchy, continue to the next frame
            logger.debug(
                f"Config file '{filename}' not found in frame {index}'s directory hierarchy."
            )

        # Fallback to current working directory if not found in any frame
        cwd = Path.cwd()
        logger.debug(f"Falling back to current working directory: '{cwd}'")
        for parent_index, parent in enumerate([cwd] + list(cwd.parents), start=1):
            potential_path = parent / filename
            logger.debug(
                f"Checking directory level {parent_index} in CWD: '{potential_path}'"
            )
            if potential_path.is_file():
                logger.debug(f"Config file '{filename}' found at: '{potential_path}'")
                return str(potential_path)
            else:
                logger.debug(
                    f"Config file '{filename}' not found at: '{potential_path}'"
                )

        # If still not found, raise an error
        error_message = (
            f"Configuration file '{filename}' not found relative to the importing module "
            f"or in the current working directory."
        )
        logger.error(error_message)
        raise FileNotFoundError(error_message)

    def _load_resources_from_path(self, path: str):
        logger.debug(f"Loading resources from path: '{path}'")
        try:
            with open(path, "r") as f:
                resources_data = json.load(f)
            logger.debug(f"Successfully loaded JSON data from '{path}'.")
        except FileNotFoundError as e:
            logger.error(
                f"Unable to locate configuration file at '{path}'. Please ensure it exists."
            )
            raise FileNotFoundError(
                f"Unable to locate configuration file at '{path}'. Please ensure it exists."
            ) from e
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in '{path}': {e}")
            raise ValueError(f"Invalid JSON in '{path}': {e}") from e

        if not isinstance(resources_data, dict):
            error_message = f"Configuration file '{path}' must contain a JSON object at the top level."
            logger.error(error_message)
            raise ValueError(error_message)

        for resource_key, data in resources_data.items():
            if isinstance(data, dict):
                # Create a resource class based on the keys in the data
                attributes = {k: type(v) for k, v in data.items()}
                self._resource_classes[resource_key] = create_resource_class(attributes)
                self._raw[resource_key] = self._resource_classes[resource_key](data)
                logger.debug(f"Loaded resource '{resource_key}' as DynamicResource.")
            else:
                self._raw[resource_key] = data
                logger.debug(f"Loaded resource '{resource_key}' as raw data.")

    def __getattr__(self, name: str) -> Union[DynamicResource, Any]:
        logger.debug(f"Accessing attribute '{name}' from ResourceProxy.")
        if name in self._raw:
            logger.debug(f"Attribute '{name}' found.")
            return self._raw[name]
        error_message = f"Resource '{name}' not found."
        logger.error(error_message)
        raise AttributeError(error_message)


# Initialize the proxy object with the default configuration file name
Resource = ResourceProxy("resources.json")
