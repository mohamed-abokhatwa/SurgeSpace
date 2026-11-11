def classFactory(iface):
    from .plugin import SurgeSpacePlugin
    return SurgeSpacePlugin(iface)
